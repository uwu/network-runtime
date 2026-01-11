use deno_core::{JsRuntime, PollEventLoopOptions, error::AnyError};
use std::collections::{BinaryHeap, HashMap};
use std::cmp::Ordering as CmpOrdering;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::runtime::Builder;
use tokio::time::timeout;

use crate::runtime;
use crate::ops::sandbox::{IsolateMessage, SystemEvent};
use crate::{vlog, vlog_err};

/// Grace period for V8 isolate termination cleanup (matches Flora's approach)
const TERMINATION_GRACE_MS: u64 = 100;

/// Configuration for runtime limits (inspired by Flora's RuntimeLimits)
#[derive(Clone, Copy, Debug)]
pub struct RuntimeLimits {
    /// Timeout for script execution (0 = no limit)
    pub execution_timeout: Option<Duration>,
    /// Timeout for event loop processing (0 = no limit)
    pub event_loop_timeout: Option<Duration>,
    /// Memory limit in bytes (0 = no limit)
    pub memory_limit_bytes: usize,
}

impl RuntimeLimits {
    /// Create new runtime limits from millisecond values
    pub fn new(execution_timeout_ms: u64, memory_limit_mb: usize) -> Self {
        Self {
            execution_timeout: timeout_from_ms(execution_timeout_ms),
            event_loop_timeout: timeout_from_ms(execution_timeout_ms),
            memory_limit_bytes: memory_limit_mb * 1024 * 1024,
        }
    }

    /// Create limits with no restrictions
    pub fn unlimited() -> Self {
        Self {
            execution_timeout: None,
            event_loop_timeout: None,
            memory_limit_bytes: 0,
        }
    }
}

fn timeout_from_ms(ms: u64) -> Option<Duration> {
    if ms == 0 {
        None
    } else {
        Some(Duration::from_millis(ms))
    }
}

/// Error type for runtime timeouts
#[derive(Debug, thiserror::Error)]
#[error("{stage} timed out")]
pub struct RuntimeTimeout {
    pub stage: &'static str,
}

/// Message sent from host to worker isolate
#[derive(Debug, Clone)]
pub struct HostToWorkerMessage {
    pub event: String,
    pub data: serde_json::Value,
}

/// V8's IsolateHandle is already Send + Sync and designed for cross-thread termination
type IsolateHandle = deno_core::v8::IsolateHandle;

// ============================================================================
// Timeout Manager - single thread that handles all timeout terminations
// ============================================================================

/// Entry in the timeout queue
struct TimeoutEntry {
    deadline: Instant,
    isolate_id: usize,
    execution_id: usize,
    handle: IsolateHandle,
    cancelled: Arc<AtomicBool>,
}

impl PartialEq for TimeoutEntry {
    fn eq(&self, other: &Self) -> bool {
        self.deadline == other.deadline && self.execution_id == other.execution_id
    }
}

impl Eq for TimeoutEntry {}

impl PartialOrd for TimeoutEntry {
    fn partial_cmp(&self, other: &Self) -> Option<CmpOrdering> {
        Some(self.cmp(other))
    }
}

impl Ord for TimeoutEntry {
    fn cmp(&self, other: &Self) -> CmpOrdering {
        // Reverse ordering for min-heap (earliest deadline first)
        other.deadline.cmp(&self.deadline)
    }
}

/// Handle returned when registering a timeout, used to cancel it
pub struct TimeoutHandle {
    cancelled: Arc<AtomicBool>,
}

impl TimeoutHandle {
    /// Cancel this timeout (call when execution completes normally)
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

impl Drop for TimeoutHandle {
    fn drop(&mut self) {
        // Auto-cancel on drop
        self.cancel();
    }
}

/// Manages timeouts for all isolate executions
struct TimeoutManager {
    queue: Mutex<BinaryHeap<TimeoutEntry>>,
    condvar: Condvar,
    next_execution_id: AtomicUsize,
    stop_flag: AtomicBool,
}

impl TimeoutManager {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(BinaryHeap::new()),
            condvar: Condvar::new(),
            next_execution_id: AtomicUsize::new(0),
            stop_flag: AtomicBool::new(false),
        })
    }

    /// Register a timeout for an isolate execution
    fn register(
        &self,
        isolate_id: usize,
        handle: IsolateHandle,
        timeout_duration: Duration,
    ) -> TimeoutHandle {
        let execution_id = self.next_execution_id.fetch_add(1, Ordering::Relaxed);
        let cancelled = Arc::new(AtomicBool::new(false));

        let entry = TimeoutEntry {
            deadline: Instant::now() + timeout_duration,
            isolate_id,
            execution_id,
            handle,
            cancelled: Arc::clone(&cancelled),
        };

        {
            let mut queue = self.queue.lock().unwrap();
            queue.push(entry);
        }

        // Wake up the timeout thread
        self.condvar.notify_one();

        TimeoutHandle { cancelled }
    }

    /// Stop the timeout manager
    fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        self.condvar.notify_one();
    }

    /// Run the timeout manager loop (call from dedicated thread)
    fn run(&self) {
        vlog!("Timeout manager thread started");

        loop {
            let mut queue = self.queue.lock().unwrap();

            // Check for shutdown
            if self.stop_flag.load(Ordering::Relaxed) {
                vlog!("Timeout manager shutting down");
                break;
            }

            // Determine how long to wait
            if let Some(entry) = queue.peek() {
                let now = Instant::now();
                if entry.deadline > now {
                    // Wait until deadline or new entry
                    let wait_duration = entry.deadline - now;
                    let (new_queue, _) = self.condvar.wait_timeout(queue, wait_duration).unwrap();
                    queue = new_queue;
                }
                // If deadline <= now, fall through to process immediately
            } else {
                // No entries, wait indefinitely for new ones
                queue = self.condvar.wait(queue).unwrap();
                continue; // Re-check after waking
            }

            // Check for shutdown again after waking
            if self.stop_flag.load(Ordering::Relaxed) {
                break;
            }

            // Process all expired entries
            let now = Instant::now();
            while let Some(entry) = queue.peek() {
                if entry.deadline > now {
                    break; // No more expired entries
                }

                let entry = queue.pop().unwrap();

                // Skip if cancelled
                if entry.cancelled.load(Ordering::Relaxed) {
                    continue;
                }

                // Terminate the isolate
                vlog_err!(
                    "Isolate #{} execution timed out, terminating...",
                    entry.isolate_id
                );
                entry.handle.terminate_execution();
            }
        }

        vlog!("Timeout manager thread stopped");
    }
}

// ============================================================================
// Worker Messages and Thread Workers
// ============================================================================

/// Messages sent to worker threads
enum WorkerMessage {
    /// Execute script on a specific isolate with timeout-based limiting
    Execute {
        isolate_id: usize,
        script: String,
        limits: RuntimeLimits,
        /// Channel to report execution result/errors
        result_sender: tokio::sync::oneshot::Sender<Result<(), ExecutionError>>,
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

/// Errors that can occur during script execution
#[derive(Debug)]
pub enum ExecutionError {
    /// Execution timed out
    Timeout { stage: &'static str },
    /// Isolate not found
    IsolateNotFound(usize),
    /// Script execution error
    ScriptError(String),
    /// Execution was terminated
    Terminated,
}

/// A worker thread that manages multiple V8 isolates
struct ThreadWorker {
    thread_id: usize,
    sender: mpsc::UnboundedSender<WorkerMessage>,
}

impl ThreadWorker {
    fn new(thread_id: usize, timeout_manager: Arc<TimeoutManager>) -> Self {
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
                        WorkerMessage::Execute { isolate_id, script, limits, result_sender } => {
                            let result = if let Some(js_runtime) = isolates.get_mut(&isolate_id) {
                                vlog!("Starting script execution on isolate #{}", isolate_id);
                                execute_with_timeout(
                                    js_runtime,
                                    isolate_id,
                                    script,
                                    &limits,
                                    &timeout_manager,
                                ).await
                            } else {
                                vlog_err!("Isolate #{} not found on thread {}", isolate_id, thread_id);
                                Err(ExecutionError::IsolateNotFound(isolate_id))
                            };

                            // Report result back
                            let _ = result_sender.send(result);
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

// ============================================================================
// Timeout-based execution functions
// ============================================================================

/// Execute a script with timeout-based resource limiting
async fn execute_with_timeout(
    js_runtime: &mut JsRuntime,
    isolate_id: usize,
    script: String,
    limits: &RuntimeLimits,
    timeout_manager: &TimeoutManager,
) -> Result<(), ExecutionError> {
    // Get the thread-safe handle for termination
    let isolate_handle = js_runtime.v8_isolate().thread_safe_handle();

    // Enter the isolate to set it as current in V8's thread-local storage
    unsafe {
        js_runtime.v8_isolate().enter();
    }

    // Register timeout with the manager if configured
    let _timeout_handle = limits.execution_timeout.map(|duration| {
        timeout_manager.register(isolate_id, isolate_handle.clone(), duration)
    });

    let result = execute_inner(js_runtime, isolate_id, script).await;

    // Timeout handle is automatically cancelled when dropped

    // If we were terminated by timeout, do graceful cleanup
    if js_runtime.v8_isolate().is_execution_terminating() {
        // Give a grace period for cleanup
        let _ = timeout(
            Duration::from_millis(TERMINATION_GRACE_MS),
            js_runtime.run_event_loop(PollEventLoopOptions::default()),
        )
        .await;

        // Cancel termination so isolate can be reused
        js_runtime.v8_isolate().cancel_terminate_execution();
    }

    // Exit the isolate when done
    unsafe {
        js_runtime.v8_isolate().exit();
    }

    vlog!("Finished executing on isolate #{}", isolate_id);
    result
}

async fn execute_inner(
    js_runtime: &mut JsRuntime,
    isolate_id: usize,
    script: String,
) -> Result<(), ExecutionError> {
    // Execute the script
    match js_runtime.execute_script("<pool_job>", script) {
        Ok(_) => {
            // Check if isolate is being terminated before running event loop
            if js_runtime.v8_isolate().is_execution_terminating() {
                vlog!("Isolate #{} execution was terminated during script", isolate_id);
                return Err(ExecutionError::Terminated);
            }

            // Run event loop
            match js_runtime.run_event_loop(PollEventLoopOptions::default()).await {
                Ok(_) => Ok(()),
                Err(e) => {
                    let error_str = format!("{:?}", e);
                    if error_str.contains("execution terminated") || error_str.contains("Uncatchable") {
                        vlog!("Isolate #{} execution was terminated", isolate_id);
                        Err(ExecutionError::Terminated)
                    } else {
                        vlog_err!("Isolate #{} event loop error: {:?}", isolate_id, e);
                        Err(ExecutionError::ScriptError(error_str))
                    }
                }
            }
        }
        Err(e) => {
            let error_str = format!("{:?}", e);
            if error_str.contains("execution terminated") || error_str.contains("Uncatchable") {
                vlog!("Isolate #{} execution was terminated", isolate_id);
                Err(ExecutionError::Terminated)
            } else {
                vlog_err!("Error executing script on isolate #{}: {:?}", isolate_id, e);
                Err(ExecutionError::ScriptError(error_str))
            }
        }
    }
}

/// Generic timeout wrapper for async operations (matches Flora's with_timeout pattern)
#[allow(dead_code)]
async fn with_timeout<T>(
    timeout_duration: Option<Duration>,
    fut: impl Future<Output = Result<T, AnyError>>,
    stage: &'static str,
) -> Result<T, AnyError> {
    match timeout_duration {
        Some(duration) => match timeout(duration, fut).await {
            Ok(result) => result,
            Err(_) => Err(AnyError::from(RuntimeTimeout { stage })),
        },
        None => fut.await,
    }
}

// ============================================================================
// Isolate tracking and pool management
// ============================================================================

/// Tracks which thread an isolate is assigned to
struct IsolateInfo {
    #[allow(dead_code)]
    isolate_id: usize,
    thread_id: usize,
    // Store the isolate handle for cross-thread termination if needed
    #[allow(dead_code)]
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
    /// Default runtime limits for new isolates
    default_limits: RuntimeLimits,
    /// Channel sender for worker->main messages
    message_sender: mpsc::UnboundedSender<(usize, IsolateMessage)>,
    /// Channel sender for system events
    system_event_sender: mpsc::UnboundedSender<SystemEvent>,
    /// Timeout manager for all isolates
    timeout_manager: Arc<TimeoutManager>,
}

impl JsWorkerPool {
    /// Create a new pool with the specified number of threads and runtime limits
    /// Returns (pool, message_receiver, system_event_receiver)
    ///
    /// # Arguments
    /// * `thread_count` - Number of worker threads
    /// * `limits` - Runtime limits (timeouts and memory) for isolates
    pub fn new(thread_count: usize, limits: RuntimeLimits) -> (Self, mpsc::UnboundedReceiver<(usize, IsolateMessage)>, mpsc::UnboundedReceiver<SystemEvent>) {
        let thread_count = thread_count.max(1);

        // Create the shared timeout manager
        let timeout_manager = TimeoutManager::new();

        // Start the timeout manager thread
        let tm_clone = Arc::clone(&timeout_manager);
        thread::spawn(move || {
            tm_clone.run();
        });

        let thread_workers: Vec<ThreadWorker> = (0..thread_count)
            .map(|i| ThreadWorker::new(i, Arc::clone(&timeout_manager)))
            .collect();

        let isolates = Arc::new(RwLock::new(HashMap::new()));

        // Create channels for messaging
        let (message_sender, message_receiver) = mpsc::unbounded_channel();
        let (system_event_sender, system_event_receiver) = mpsc::unbounded_channel();

        vlog!("Worker pool created with {} threads, limits: {:?}", thread_count, limits);

        let pool = JsWorkerPool {
            thread_workers,
            isolates,
            next_isolate_id: AtomicUsize::new(0),
            next_thread_idx: AtomicUsize::new(0),
            default_limits: limits,
            message_sender,
            system_event_sender,
            timeout_manager,
        };

        (pool, message_receiver, system_event_receiver)
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
            memory_limit_bytes: self.default_limits.memory_limit_bytes,
            response: tx,
            message_sender: self.message_sender.clone(),
            host_message_receiver: host_msg_rx,
        });

        // Wait for the isolate to be created and get the handle
        let isolate_handle = rx.await.map_err(|_| "Failed to create isolate".to_string())??;

        // Track the isolate
        let info = IsolateInfo {
            isolate_id,
            thread_id: thread_idx,
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

    /// Execute a script on a specific isolate with timeout-based resource limiting
    /// Returns a receiver for the execution result
    pub fn execute(&self, isolate_id: usize, script: impl Into<String>) -> Option<tokio::sync::oneshot::Receiver<Result<(), ExecutionError>>> {
        let isolates = self.isolates.read().unwrap();

        if let Some(info) = isolates.get(&isolate_id) {
            let (result_tx, result_rx) = tokio::sync::oneshot::channel();
            self.thread_workers[info.thread_id].send(WorkerMessage::Execute {
                isolate_id,
                script: script.into(),
                limits: self.default_limits,
                result_sender: result_tx,
            });
            Some(result_rx)
        } else {
            vlog_err!("Isolate #{} not found", isolate_id);
            None
        }
    }

    /// Execute a script on a specific isolate (fire-and-forget version)
    pub fn execute_fire_and_forget(&self, isolate_id: usize, script: impl Into<String>) {
        let _ = self.execute(isolate_id, script);
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
        vlog!("Shutting down worker pool...");

        // Stop the timeout manager first
        self.timeout_manager.stop();

        // Then shutdown worker threads
        for worker in &self.thread_workers {
            worker.send(WorkerMessage::Shutdown);
        }
    }

    /// Get the current runtime limits
    pub fn limits(&self) -> RuntimeLimits {
        self.default_limits
    }
}
