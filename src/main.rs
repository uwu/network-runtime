mod runtime;
mod pool;
mod ops;
mod log;

use pool::JsWorkerPool;
use std::time::Duration;
use std::rc::Rc;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    // Install rustls crypto provider before any TLS operations
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install default crypto provider");

    // Parse command line arguments
    let args: Vec<String> = std::env::args().collect();

    // Check for verbose flag
    let verbose = args.iter().any(|arg| arg == "--verbose" || arg == "-v");
    log::set_verbose(verbose);

    // Filter out flags from args
    let args: Vec<String> = args.into_iter().filter(|arg| arg != "--verbose" && arg != "-v").collect();

    if args.len() < 2 {
        alog_err!("Usage: {} <script.js> [thread_count] [cpu_limit_ms] [memory_limit_mb] [--verbose|-v]", args[0]);
        alog_err!("\nExample: {} main.js 2 500 128", args[0]);
        alog_err!("         {} main.js 4 1000 256 --verbose", args[0]);
        alog_err!("\n  thread_count:   Number of worker threads (default: 2)");
        alog_err!("  cpu_limit_ms:   CPU time limit per isolate in ms (default: 500)");
        alog_err!("  memory_limit_mb: Memory limit per isolate in MB (default: 0 = no limit)");
        std::process::exit(1);
    }

    let script_path = args[1].clone();
    let thread_count = args.get(2)
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(2);
    let cpu_limit_ms = args.get(3)
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(500);
    let memory_limit_mb = args.get(4)
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);

    vlog!("=== V8 Sandbox Runtime ===");
    vlog!("Script: {}", script_path);
    vlog!("Threads: {}", thread_count);
    vlog!("CPU Limit: {}ms per isolate", cpu_limit_ms);
    vlog!("Memory Limit: {}\n", if memory_limit_mb == 0 { "unlimited".to_string() } else { format!("{} MB", memory_limit_mb) });

    // Create the worker pool and get channel receivers
    let (pool, message_receiver, system_event_receiver) = JsWorkerPool::new(thread_count, Duration::from_millis(cpu_limit_ms), memory_limit_mb);
    let pool = Rc::new(pool);

    // Create the privileged main isolate with sandbox ops
    let mut main_runtime = runtime::create_privileged_runtime(Rc::clone(&pool));

    // Wrap receivers in Arc<Mutex> for interior mutability (concurrent access from JS)
    main_runtime.op_state().borrow_mut().put(std::sync::Arc::new(tokio::sync::Mutex::new(message_receiver)));
    main_runtime.op_state().borrow_mut().put(std::sync::Arc::new(tokio::sync::Mutex::new(system_event_receiver)));

    vlog!("=== Executing main script ===\n");

    // Load and execute the user's script as a module using the FsModuleLoader
    // Convert relative path to absolute path
    let absolute_path = std::path::Path::new(&script_path)
        .canonicalize()
        .unwrap_or_else(|e| {
            alog_err!("Failed to resolve script path '{}': {}", script_path, e);
            std::process::exit(1);
        });

    let module_specifier = deno_core::ModuleSpecifier::from_file_path(&absolute_path)
        .unwrap_or_else(|_| {
            alog_err!("Failed to create module specifier from path: {:?}", absolute_path);
            std::process::exit(1);
        });

    // Load the main module
    let module_id = match main_runtime.load_main_es_module(&module_specifier).await {
        Ok(id) => id,
        Err(e) => {
            alog_err!("Error loading module: {:?}", e);
            std::process::exit(1);
        }
    };

    // Evaluate the module - don't await yet!
    // This allows the event loop to drive async operations within the module
    let mod_result = main_runtime.mod_evaluate(module_id);

    // Run the event loop to process async ops
    if let Err(e) = main_runtime.run_event_loop(Default::default()).await {
        alog_err!("Error running event loop: {:?}", e);
        std::process::exit(1);
    }

    // Now await the module evaluation result
    if let Err(e) = mod_result.await {
        alog_err!("Error evaluating module: {:?}", e);
        std::process::exit(1);
    }

    vlog!("\n=== Shutting down ===");

    // Shutdown the pool
    pool.shutdown();

    // Give time for worker threads to finish processing and cleanup
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    vlog!("=== Shutdown complete ===");
}
