/// Operations module - organized into submodules by functionality
pub mod sandbox;
pub mod worker;
pub mod util;

// Re-export commonly used items
pub use sandbox::IsolateMessage;

use deno_core::Extension;

/// Extension providing privileged ops for the main isolate
deno_core::extension!(
    privileged_ops,
    ops = [
        sandbox::op_sandbox_create_isolate,
        sandbox::op_sandbox_execute,
        sandbox::op_sandbox_destroy_isolate,
        sandbox::op_sandbox_thread_count,
        sandbox::op_sandbox_isolate_count,
        sandbox::op_sandbox_shutdown,
        sandbox::op_sandbox_poll_messages,
        sandbox::op_sandbox_poll_system_events,
        sandbox::op_sandbox_send_to_isolate,
        util::op_tls_peer_certificate,
        util::op_set_raw,
    ],
    esm = [dir "src/js", "bootstrap.js"]
);

/// Module for worker ops
pub mod worker_ops {
    pub use super::worker::init;
}
