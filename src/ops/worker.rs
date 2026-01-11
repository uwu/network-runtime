/// Worker messaging ops - available in worker isolates for communication
use deno_core::{op2, OpState, Extension};
use tokio::sync::mpsc;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::ops::sandbox::IsolateMessage;
use crate::pool::HostToWorkerMessage;
use serde::{Deserialize, Serialize};

/// Global counter for WebSocket connection IDs
static NEXT_WS_CONN_ID: AtomicUsize = AtomicUsize::new(0);

/// Message received from host
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostMessage {
    pub event: String,
    pub data: serde_json::Value,
}

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

/// Receive a message from the host (async, waits for message)
/// This is the key op that allows workers to receive messages during their event loop
#[op2(async)]
#[serde]
pub async fn op_worker_recv(
    state: Rc<RefCell<OpState>>,
) -> Result<Option<HostMessage>, deno_core::error::CoreError> {
    // Get the Arc<Mutex<Receiver>> from OpState
    let receiver = {
        let state_borrow = state.borrow();
        // Use borrow() which panics if not found - helps debug type mismatches
        state_borrow.borrow::<Arc<Mutex<mpsc::UnboundedReceiver<HostToWorkerMessage>>>>().clone()
    };

    // Lock the receiver and wait for a message
    let mut rx = receiver.lock().await;

    // Wait for a message (this properly yields to the event loop)
    match rx.recv().await {
        Some(msg) => Ok(Some(HostMessage {
            event: msg.event,
            data: msg.data,
        })),
        None => Ok(None), // Channel closed
    }
}

deno_core::extension!(
    worker_messaging,
    ops = [
        op_worker_send,
        op_worker_websocket_open,
        op_worker_websocket_send,
        op_worker_websocket_close,
        op_worker_recv,
    ],
    esm = [dir "src/js", "bootstrap_worker.js"],
);

pub fn init() -> Extension {
    worker_messaging::init()
}
