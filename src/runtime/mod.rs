mod transpile;
use deno_core::{Extension, ExtensionFileSource, FsModuleLoader, JsRuntime, RuntimeOptions};
use deno_permissions::{PermissionsContainer, RuntimePermissionDescriptorParser};
use std::{borrow::Cow, rc::Rc, sync::Arc};
use crate::pool::JsWorkerPool;
use sys_traits::impls::RealSys;

// Bootstrap for main/privileged runtime (with web APIs, crypto, and fetch)
const BOOTSTRAP_MAIN_SPECIFIER: &str = "ext:bootstrap_main/bootstrap.js";
const BOOTSTRAP_MAIN_DEPS: &[&str] = &[
    "deno_webidl",
    "deno_web",
    "deno_crypto",
    "deno_fetch",
    "deno_websocket",
    "deno_net",
    "deno_io",
    "deno_fs",
];

// Bootstrap for worker isolates (minimal, no APIs)
const BOOTSTRAP_WORKER_SPECIFIER: &str = "ext:bootstrap_worker/bootstrap.js";
const BOOTSTRAP_WORKER_DEPS: &[&str] = &[];

/// Creates a bootstrap extension for the main/privileged runtime
/// Includes all web APIs, crypto, fetch, and sandbox management
fn bootstrap_main_extension() -> Extension {
    Extension {
        name: "bootstrap_main",
        deps: BOOTSTRAP_MAIN_DEPS,
        esm_files: Cow::Owned(vec![ExtensionFileSource::new(
            BOOTSTRAP_MAIN_SPECIFIER,
            deno_core::ascii_str!(include_str!("bootstrap_main.js")),
        )]),
        esm_entry_point: Some(BOOTSTRAP_MAIN_SPECIFIER),
        ..Default::default()
    }
}

/// Creates a minimal bootstrap extension for worker isolates
/// No APIs - completely isolated
fn bootstrap_worker_extension() -> Extension {
    Extension {
        name: "bootstrap_worker",
        deps: BOOTSTRAP_WORKER_DEPS,
        esm_files: Cow::Owned(vec![ExtensionFileSource::new(
            BOOTSTRAP_WORKER_SPECIFIER,
            deno_core::ascii_str!(include_str!("bootstrap_worker.js")),
        )]),
        esm_entry_point: Some(BOOTSTRAP_WORKER_SPECIFIER),
        ..Default::default()
    }
}

pub fn create_runtime() -> JsRuntime {
    let blob_store = Arc::new(deno_web::BlobStore::default());
    let broadcast_channel = deno_web::InMemoryBroadcastChannel::default();

    // Extensions must be in dependency order
    JsRuntime::new(RuntimeOptions {
        extensions: vec![
            deno_webidl::deno_webidl::init(),
            deno_web::deno_web::init(blob_store, None, broadcast_channel),
            deno_crypto::deno_crypto::init(None),
            bootstrap_main_extension()
        ],
        module_loader: None,
        extension_transpiler: Some(Rc::new(|specifier, source| {
            match transpile::transpile_if_typescript(&specifier, source.as_str())? {
                Some(result) => Ok((result.code, result.source_map)),
                None => Ok((source, None)),
            }
        })),
        ..Default::default()
    })
}

/// Creates a worker runtime with messaging capabilities
/// Includes web APIs (console, timers, crypto, etc.) but NO network access
///
/// # Arguments
/// * `isolate_id` - Unique identifier for this isolate
/// * `message_sender` - Channel for sending messages to host
/// * `host_message_receiver` - Channel for receiving messages from host
/// * `memory_limit_bytes` - Memory limit in bytes (0 = no limit)
pub fn create_worker_runtime(
    isolate_id: usize,
    message_sender: tokio::sync::mpsc::UnboundedSender<(usize, crate::ops::sandbox::IsolateMessage)>,
    host_message_receiver: tokio::sync::mpsc::UnboundedReceiver<crate::pool::HostToWorkerMessage>,
    memory_limit_bytes: usize,
) -> JsRuntime {
    // Create isolated blob store for this worker
    let blob_store = Arc::new(deno_web::BlobStore::default());
    let broadcast_channel = deno_web::InMemoryBroadcastChannel::default();

    // Set up V8 CreateParams with memory limit if specified
    let create_params = if memory_limit_bytes > 0 {
        Some(deno_core::v8::Isolate::create_params().heap_limits(0, memory_limit_bytes))
    } else {
        None
    };

    let runtime = JsRuntime::new(RuntimeOptions {
        create_params,
        extensions: vec![
            // Core web APIs (required for timers, console, etc.)
            deno_webidl::deno_webidl::init(),
            deno_web::deno_web::init(blob_store, None, broadcast_channel),
            // Crypto APIs (non-network)
            deno_crypto::deno_crypto::init(None),
            // Worker messaging
            crate::ops::worker_ops::init(),
            // Worker bootstrap (must be last)
            bootstrap_worker_extension(),
        ],
        ..Default::default()
    });

    // Store isolate ID and message sender in OpState for worker ops
    runtime.op_state().borrow_mut().put(isolate_id);
    runtime.op_state().borrow_mut().put(message_sender);
    // Store host message receiver wrapped in Arc<Mutex> for async access
    runtime.op_state().borrow_mut().put(
        std::sync::Arc::new(tokio::sync::Mutex::new(host_message_receiver))
    );

    runtime
}

/// Creates a privileged runtime for the main isolate with sandbox management ops
pub fn create_privileged_runtime(pool: Rc<JsWorkerPool>) -> JsRuntime {
    let blob_store = Arc::new(deno_web::BlobStore::default());
    let broadcast_channel = deno_web::InMemoryBroadcastChannel::default();

    // Create FsModuleLoader with current directory as base
    let module_loader = Rc::new(FsModuleLoader);

    let permissions =
        PermissionsContainer::allow_all(Arc::new(RuntimePermissionDescriptorParser::new(RealSys)));

    // Extensions must be in dependency order
    let runtime = JsRuntime::new(RuntimeOptions {
        extensions: vec![
            // Telemetry (first)
            deno_telemetry::deno_telemetry::init(),
            // Basic foundation APIs
            deno_webidl::deno_webidl::init(),
            // Web APIs (includes console, URL - depends on webidl)
            deno_web::deno_web::init(blob_store.clone(), None, broadcast_channel),
            // Crypto
            deno_crypto::deno_crypto::init(None),
            // Network APIs
            deno_net::deno_net::init(None, None),  // (root_cert_store, unsafely_ignore_certificate_errors)
            deno_tls::deno_tls::init(),
            deno_fetch::deno_fetch::init(Default::default()),
            deno_websocket::deno_websocket::init(),
            // Custom ops (provides stub ops for deno_io/deno_fs)
            crate::ops::privileged_ops::init(),
            // I/O and filesystem (after stub ops are registered)
            deno_io::deno_io::init(Some(deno_io::Stdio::default())),
            deno_fs::deno_fs::init(Rc::new(deno_fs::RealFs)),
            // Bootstrap (last)
            bootstrap_main_extension()
        ],
        module_loader: Some(module_loader),
        extension_transpiler: Some(Rc::new(|specifier, source| {
            match transpile::transpile_if_typescript(&specifier, source.as_str())? {
                Some(result) => Ok((result.code, result.source_map)),
                None => Ok((source, None)),
            }
        })),
        ..Default::default()
    });

    runtime.op_state().borrow_mut().put(permissions);
    
    // Store the pool in the OpState so ops can access it
    runtime.op_state().borrow_mut().put(pool);

    runtime
}

