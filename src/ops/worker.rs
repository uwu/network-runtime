/// Worker messaging ops - available in worker isolates for communication
use deno_core::{op2, OpState, Extension};
use tokio::sync::mpsc;
use std::sync::atomic::{AtomicUsize, Ordering};
use crate::ops::sandbox::IsolateMessage;

/// Global counter for WebSocket connection IDs
static NEXT_WS_CONN_ID: AtomicUsize = AtomicUsize::new(0);

/// Send a message from worker to main
#[op2]
pub fn op_worker_send(
    state: &mut OpState,
    #[string] event: String,
    #[serde] data: serde_json::Value,
) -> Result<(), deno_core::error::CoreError> {
    // Get isolate ID from OpState
    let isolate_id = *state.borrow::<usize>();

    // Get message sender from OpState
    let sender = state.borrow::<mpsc::UnboundedSender<(usize, IsolateMessage)>>().clone();

    // Send message to main via channel
    let msg = IsolateMessage { event, data };
    sender.send((isolate_id, msg))
        .map_err(|e| deno_core::error::CoreError::from(std::io::Error::new(std::io::ErrorKind::BrokenPipe, e.to_string())))?;

    Ok(())
}

/// Open a WebSocket connection (returns connection ID)
#[op2]
#[serde]
pub fn op_worker_websocket_open(
    state: &mut OpState,
    #[string] url: String,
) -> Result<usize, deno_core::error::CoreError> {
    let isolate_id = *state.borrow::<usize>();
    let sender = state.borrow::<mpsc::UnboundedSender<(usize, IsolateMessage)>>().clone();

    // Generate unique connection ID
    let conn_id = NEXT_WS_CONN_ID.fetch_add(1, Ordering::Relaxed);

    // Notify host that this isolate wants to open a WebSocket
    sender.send((isolate_id, IsolateMessage {
        event: "ws.open".to_string(),
        data: serde_json::json!({
            "conn_id": conn_id,
            "url": url,
        }),
    }))
    .map_err(|e| deno_core::error::CoreError::from(std::io::Error::new(std::io::ErrorKind::BrokenPipe, e.to_string())))?;

    Ok(conn_id)
}

/// Send data through a WebSocket connection
#[op2]
pub fn op_worker_websocket_send(
    state: &mut OpState,
    #[serde] conn_id: usize,
    #[string] data: String,
) -> Result<(), deno_core::error::CoreError> {
    let isolate_id = *state.borrow::<usize>();
    let sender = state.borrow::<mpsc::UnboundedSender<(usize, IsolateMessage)>>().clone();

    sender.send((isolate_id, IsolateMessage {
        event: "ws.send".to_string(),
        data: serde_json::json!({
            "conn_id": conn_id,
            "data": data,
        }),
    }))
    .map_err(|e| deno_core::error::CoreError::from(std::io::Error::new(std::io::ErrorKind::BrokenPipe, e.to_string())))?;

    Ok(())
}

/// Close a WebSocket connection
#[op2]
pub fn op_worker_websocket_close(
    state: &mut OpState,
    #[serde] conn_id: usize,
) -> Result<(), deno_core::error::CoreError> {
    let isolate_id = *state.borrow::<usize>();
    let sender = state.borrow::<mpsc::UnboundedSender<(usize, IsolateMessage)>>().clone();

    sender.send((isolate_id, IsolateMessage {
        event: "ws.close".to_string(),
        data: serde_json::json!({
            "conn_id": conn_id,
        }),
    }))
    .map_err(|e| deno_core::error::CoreError::from(std::io::Error::new(std::io::ErrorKind::BrokenPipe, e.to_string())))?;

    Ok(())
}

deno_core::extension!(
    worker_messaging,
    ops = [
        op_worker_send,
        op_worker_websocket_open,
        op_worker_websocket_send,
        op_worker_websocket_close,
    ],
    esm = [dir "src/js", "bootstrap_worker.js"],
);

pub fn init() -> Extension {
    worker_messaging::init()
}
