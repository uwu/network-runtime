use deno_core::JsRuntime;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::runtime::Builder;

use crate::runtime;
use crate::ops::sandbox::{IsolateMessage, SystemEvent};
use crate::{vlog, vlog_err};

/// Message sent from host to worker isolate
#[derive(Debug, Clone)]
pub struct HostToWorkerMessage {
    pub event: String,
    pub data: serde_json::Value,
}

/// V8's IsolateHandle is already Send + Sync and designed for cross-thread termination
type IsolateHandle = deno_core::v8::IsolateHandle;

/// Messages sent to worker threads
enum WorkerMessage {
    /// Execute script on a specific isolate
    Execute {
        isolate_id: usize,
        script: String,
        cpu_tracker: Arc<Mutex<CpuTimeTracker>>,
    },
    /// Create a new isolate on this thread
    CreateIsolate {
        isolate_id: usize,
        memory_limit_bytes: usize,
        response: tokio::sync::oneshot::Sender<Result<IsolateHandle, String>>,
        message_sender: mpsc::UnboundedSender<(usize, IsolateMessage)>,
        /// Receiver for messages from host to this worker
        host_message_receiver: mpsc::UnboundedReceiver<HostToWorkerMessage>,
    },
    /// Destroy an isolate on this thread
    DestroyIsolate { isolate_id: usize },
    /// Shutdown the worker thread
    Shutdown,
}

/// A worker thread that manages multiple V8 isolates
struct ThreadWorker {
    thread_id: usize,
    sender: mpsc::UnboundedSender<WorkerMessage>,
}

impl ThreadWorker {
    fn new(thread_id: usize) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<WorkerMessage>();

        thread::spawn(move || {
            let rt = Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();

            rt.block_on(async move {
                vlog!("Thread Worker #{} started (OS Thread {:?})", thread_id, thread::current().id());

                // HashMap of isolate_id -> JsRuntime
                let mut isolates: HashMap<usize, JsRuntime> = HashMap::new();

                while let Some(msg) = rx.recv().await {
                    match msg {
                        WorkerMessage::Execute { isolate_id, script, cpu_tracker } => {
                            if let Some(js_runtime) = isolates.get_mut(&isolate_id) {
                                // Start CPU time tracking
                                cpu_tracker.lock().unwrap().start();

                                // Enter the isolate to set it as current in V8's thread-local storage
                                unsafe {
                                    js_runtime.v8_isolate().enter();
                                }

                                vlog!("Starting script execution on isolate #{}", isolate_id);
                                match js_runtime.execute_script("<pool_job>", script) {
                                    Ok(_) => {
                                        // Check if isolate is being terminated before running event loop
                                        if js_runtime.v8_isolate().is_execution_terminating() {
                                            vlog!("Isolate #{} execution was terminated during script", isolate_id);
                                        } else if let Err(e) = js_runtime.run_event_loop(Default::default()).await {
                                            // Check if this is a termination error
                                            let error_str = format!("{:?}", e);
                                            if error_str.contains("execution terminated") || error_str.contains("Uncatchable") {
                                                vlog!("Isolate #{} execution was terminated", isolate_id);
                                            } else {
                                                vlog_err!("Error running event loop on isolate #{}: {:?}", isolate_id, e);
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        // Check if this is a termination error
                                        let error_str = format!("{:?}", e);
                                        if error_str.contains("execution terminated") || error_str.contains("Uncatchable") {
                                            vlog!("Isolate #{} execution was terminated", isolate_id);
                                        } else {
                                            vlog_err!("Error executing script on isolate #{}: {:?}", isolate_id, e);
                                        }
                                    }
                                }

                                // Exit the isolate when done
                                unsafe {
                                    js_runtime.v8_isolate().exit();
                                }

                                // Stop CPU time tracking
                                cpu_tracker.lock().unwrap().stop();

                                vlog!("Finished executing on isolate #{}", isolate_id);
                            } else {
                                vlog_err!("Isolate #{} not found on thread {}", isolate_id, thread_id);
                            }
                        }
                        WorkerMessage::CreateIsolate { isolate_id, memory_limit_bytes, response, message_sender, host_message_receiver } => {
                            vlog!("Creating isolate #{} on thread {} (memory limit: {} MB)", isolate_id, thread_id, memory_limit_bytes / 1024 / 1024);
                            let mut js_runtime = runtime::create_worker_runtime(isolate_id, message_sender.clone(), host_message_receiver, memory_limit_bytes);

                            // Get the thread-safe handle which can be used to terminate from any thread
                            let handle = js_runtime.v8_isolate().thread_safe_handle();

                            // Start the host message loop now that OpState is fully initialized
                            if let Err(e) = js_runtime.execute_script("<start_message_loop>", "globalThis.__startHostMessageLoop && globalThis.__startHostMessageLoop() && (delete globalThis.__startHostMessagingLoop())") {
                                vlog_err!("Failed to start message loop on isolate #{}: {:?}", isolate_id, e);
                            }

                            // Exit the isolate after creation so it's not left as "current"
                            // It will be re-entered when needed for execution
                            unsafe {
                                js_runtime.v8_isolate().exit();
                            }

                            isolates.insert(isolate_id, js_runtime);
                            let _ = response.send(Ok(handle));
                        }
                        WorkerMessage::DestroyIsolate { isolate_id } => {
                            vlog!("Destroying isolate #{} on thread {}", isolate_id, thread_id);
                            if let Some(mut js_runtime) = isolates.remove(&isolate_id) {
                                // Re-enter the isolate before dropping so V8 can clean up properly
                                unsafe {
                                    js_runtime.v8_isolate().enter();
                                }
                                // js_runtime will be dropped here, which exits the isolate
                            }
                        }
                        WorkerMessage::Shutdown => {
                            vlog!("Thread Worker #{} shutting down with {} isolates", thread_id, isolates.len());
                            // Re-enter all isolates before dropping them
                            for (_isolate_id, mut js_runtime) in isolates.drain() {
                                unsafe {
                                    js_runtime.v8_isolate().enter();
                                }
                                // js_runtime will be dropped here with the isolate entered
                            }
                            break;
                        }
                    }
                }
            });
        });

        ThreadWorker {
            thread_id,
            sender: tx,
        }
    }

    fn send(&self, msg: WorkerMessage) {
        if let Err(e) = self.sender.send(msg) {
            vlog_err!("Failed to send message to thread {}: {}", self.thread_id, e);
        }
    }
}

/// Tracks CPU time usage for an isolate
#[derive(Clone)]
pub struct CpuTimeTracker {
    start_time: Option<Instant>,
    accumulated_time: Duration,
    limit: Duration,
}

impl CpuTimeTracker {
    pub fn new(limit: Duration) -> Self {
        Self {
            start_time: None,
            accumulated_time: Duration::ZERO,
            limit,
        }
    }

    pub fn start(&mut self) {
        self.start_time = Some(Instant::now());
    }

    pub fn stop(&mut self) {
        if let Some(start) = self.start_time.take() {
            self.accumulated_time += start.elapsed();
        }
    }

    pub fn total_time(&self) -> Duration {
        let current_run = self.start_time.map(|s| s.elapsed()).unwrap_or(Duration::ZERO);
        self.accumulated_time + current_run
    }

    pub fn is_over_limit(&self) -> bool {
        self.total_time() > self.limit
    }
}

/// Tracks which thread an isolate is assigned to
struct IsolateInfo {
    #[allow(dead_code)]
    isolate_id: usize,
    thread_id: usize,
    cpu_tracker: Arc<Mutex<CpuTimeTracker>>,
    terminated: AtomicBool,
    // Store the isolate handle for cross-thread termination
    isolate_handle: IsolateHandle,
    // Channel for sending messages from host to this worker
    host_message_sender: mpsc::UnboundedSender<HostToWorkerMessage>,
}

pub struct JsWorkerPool {
    /// The thread workers (each manages multiple isolates)
    thread_workers: Vec<ThreadWorker>,
    /// Mapping of isolate_id -> IsolateInfo
    isolates: Arc<RwLock<HashMap<usize, IsolateInfo>>>,
    /// Counter for generating unique isolate IDs
    next_isolate_id: AtomicUsize,
    /// Round-robin counter for thread selection
    next_thread_idx: AtomicUsize,
    /// Default CPU time limit for new isolates
    default_cpu_limit: Duration,
    /// Default memory limit for new isolates (in bytes)
    default_memory_limit: usize,
    /// Flag to stop the watcher thread
    watcher_stop: Arc<AtomicBool>,
    /// Channel sender for worker->main messages
    message_sender: mpsc::UnboundedSender<(usize, IsolateMessage)>,
    /// Channel sender for system events
    system_event_sender: mpsc::UnboundedSender<SystemEvent>,
}

impl JsWorkerPool {
    /// Create a new pool with the specified number of threads, CPU time limit, and memory limit
    /// Returns (pool, message_receiver, system_event_receiver)
    ///
    /// # Arguments
    /// * `thread_count` - Number of worker threads
    /// * `cpu_limit` - CPU time limit per isolate
    /// * `memory_limit_mb` - Memory limit per isolate in megabytes (0 = no limit)
    pub fn new(thread_count: usize, cpu_limit: Duration, memory_limit_mb: usize) -> (Self, mpsc::UnboundedReceiver<(usize, IsolateMessage)>, mpsc::UnboundedReceiver<SystemEvent>) {
        let thread_count = thread_count.max(1);

        let thread_workers: Vec<ThreadWorker> = (0..thread_count)
            .map(|i| ThreadWorker::new(i))
            .collect();

        let isolates = Arc::new(RwLock::new(HashMap::new()));
        let watcher_stop = Arc::new(AtomicBool::new(false));

        // Create a shared reference to thread workers for the watcher
        let workers_for_watcher: Vec<mpsc::UnboundedSender<WorkerMessage>> =
            thread_workers.iter().map(|w| w.sender.clone()).collect();

        // Create channels for messaging
        let (message_sender, message_receiver) = mpsc::unbounded_channel();
        let (system_event_sender, system_event_receiver) = mpsc::unbounded_channel();

        // Start the watcher thread
        Self::start_watcher(
            Arc::clone(&isolates),
            Arc::clone(&watcher_stop),
            workers_for_watcher,
            system_event_sender.clone(),
        );

        let pool = JsWorkerPool {
            thread_workers,
            isolates,
            next_isolate_id: AtomicUsize::new(0),
            next_thread_idx: AtomicUsize::new(0),
            default_cpu_limit: cpu_limit,
            default_memory_limit: memory_limit_mb * 1024 * 1024, // Convert MB to bytes
            watcher_stop,
            message_sender,
            system_event_sender,
        };

        (pool, message_receiver, system_event_receiver)
    }

    /// Start the CPU time watcher thread
    fn start_watcher(
        isolates: Arc<RwLock<HashMap<usize, IsolateInfo>>>,
        stop_flag: Arc<AtomicBool>,
        workers: Vec<mpsc::UnboundedSender<WorkerMessage>>,
        system_event_sender: mpsc::UnboundedSender<SystemEvent>,
    ) {
        thread::spawn(move || {
            vlog!("CPU Watcher thread started");

            while !stop_flag.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100));

                // Collect isolates that need to be terminated
                let to_terminate: Vec<(usize, usize)> = {
                    let isolates_lock = isolates.read().unwrap();

                    isolates_lock.iter()
                        .filter_map(|(isolate_id, info)| {
                            let tracker = info.cpu_tracker.lock().unwrap();

                            if tracker.is_over_limit() && !info.terminated.load(Ordering::Relaxed) {
                                let total = tracker.total_time();
                                let limit = tracker.limit;
                                vlog_err!(
                                    "Isolate #{} exceeded CPU limit: {:?} > {:?}",
                                    isolate_id, total, limit
                                );

                                Some((*isolate_id, info.thread_id))
                            } else {
                                None
                            }
                        })
                        .collect()
                };

                // Terminate and clean up each violating isolate
                for (isolate_id, _thread_id) in to_terminate {
                    // Get the isolate handle for termination
                    let isolate_handle = {
                        let isolates_lock = isolates.read().unwrap();
                        if let Some(info) = isolates_lock.get(&isolate_id) {
                            // Mark as terminated first
                            info.terminated.store(true, Ordering::Relaxed);
                            Some(info.isolate_handle.clone())
                        } else {
                            None
                        }
                    };

                    // Actually terminate the V8 isolate execution
                    // IsolateHandle::terminate_execution is thread-safe and designed for this
                    if let Some(handle) = isolate_handle {
                        if handle.terminate_execution() {
                            vlog!("Terminated execution for isolate #{}", isolate_id);
                        } else {
                            vlog_err!("Failed to terminate isolate #{} (may already be terminated)", isolate_id);
                        }
                    }

                    // Remove from tracking HashMap
                    // This prevents new work from being sent to this isolate
                    {
                        let mut isolates_lock = isolates.write().unwrap();
                        isolates_lock.remove(&isolate_id);
                        vlog!("Removed isolate #{} from tracking", isolate_id);
                    }

                    // Send system event for termination
                    let _ = system_event_sender.send(SystemEvent {
                        event_type: "terminated".to_string(),
                        isolate_id,
                        data: serde_json::json!({
                            "reason": "cpu_limit_exceeded"
                        }),
                    });
                }
            }

            vlog!("CPU Watcher thread stopped");
        });
    }

    /// Create a new isolate and return its ID
    /// This is an async function that waits for the isolate to be fully created
    pub async fn create_isolate(&self) -> Result<usize, String> {
        let isolate_id = self.next_isolate_id.fetch_add(1, Ordering::Relaxed);

        // Round-robin thread selection
        let thread_idx = self.next_thread_idx.fetch_add(1, Ordering::Relaxed) % self.thread_workers.len();

        // Create a oneshot channel for synchronization
        let (tx, rx) = tokio::sync::oneshot::channel();

        // Create channel for host-to-worker messages
        let (host_msg_tx, host_msg_rx) = mpsc::unbounded_channel();

        // Send create message to the selected thread
        self.thread_workers[thread_idx].send(WorkerMessage::CreateIsolate {
            isolate_id,
            memory_limit_bytes: self.default_memory_limit,
            response: tx,
            message_sender: self.message_sender.clone(),
            host_message_receiver: host_msg_rx,
        });

        // Wait for the isolate to be created and get the handle
        let isolate_handle = rx.await.map_err(|_| "Failed to create isolate".to_string())??;

        // Create CPU time tracker for this isolate
        let cpu_tracker = Arc::new(Mutex::new(CpuTimeTracker::new(self.default_cpu_limit)));

        // Track the isolate
        let info = IsolateInfo {
            isolate_id,
            thread_id: thread_idx,
            cpu_tracker,
            terminated: AtomicBool::new(false),
            isolate_handle,
            host_message_sender: host_msg_tx,
        };
        self.isolates.write().unwrap().insert(isolate_id, info);

        Ok(isolate_id)
    }

    /// Destroy an isolate by ID
    pub fn destroy_isolate(&self, isolate_id: usize) -> Result<(), String> {
        let mut isolates = self.isolates.write().unwrap();

        if let Some(info) = isolates.remove(&isolate_id) {
            self.thread_workers[info.thread_id].send(WorkerMessage::DestroyIsolate { isolate_id });

            // Send system event for manual destruction
            let _ = self.system_event_sender.send(SystemEvent {
                event_type: "destroyed".to_string(),
                isolate_id,
                data: serde_json::json!({
                    "reason": "manual"
                }),
            });

            Ok(())
        } else {
            Err(format!("Isolate #{} not found", isolate_id))
        }
    }

    /// Execute a script on a specific isolate
    pub fn execute(&self, isolate_id: usize, script: impl Into<String>) {
        let isolates = self.isolates.read().unwrap();

        if let Some(info) = isolates.get(&isolate_id) {
            self.thread_workers[info.thread_id].send(WorkerMessage::Execute {
                isolate_id,
                script: script.into(),
                cpu_tracker: Arc::clone(&info.cpu_tracker),
            });
        } else {
            vlog_err!("Isolate #{} not found", isolate_id);
        }
    }

    /// Send a message to a specific isolate (non-blocking, processed within event loop)
    pub fn send_to_isolate(&self, isolate_id: usize, event: String, data: serde_json::Value) -> Result<(), String> {
        let isolates = self.isolates.read().unwrap();

        if let Some(info) = isolates.get(&isolate_id) {
            info.host_message_sender
                .send(HostToWorkerMessage { event, data })
                .map_err(|e| format!("Failed to send message to isolate #{}: {}", isolate_id, e))?;
            Ok(())
        } else {
            Err(format!("Isolate #{} not found", isolate_id))
        }
    }

    /// Get the number of threads in the pool
    pub fn thread_count(&self) -> usize {
        self.thread_workers.len()
    }

    /// Get the number of active isolates
    pub fn isolate_count(&self) -> usize {
        self.isolates.read().unwrap().len()
    }


    /// Shutdown all threads
    pub fn shutdown(&self) {
        // Stop the watcher thread first
        self.watcher_stop.store(true, Ordering::Relaxed);

        // Then shutdown worker threads
        for worker in &self.thread_workers {
            worker.send(WorkerMessage::Shutdown);
        }
    }
}
