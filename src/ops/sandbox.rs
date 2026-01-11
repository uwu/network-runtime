/// Sandbox management ops - available only in the privileged main isolate
use deno_core::{op2, OpState};
use std::cell::RefCell;
use std::rc::Rc;
use crate::pool::JsWorkerPool;
use serde::{Deserialize, Serialize};

/// Message sent between isolates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsolateMessage {
    pub event: String,
    pub data: serde_json::Value,
}

/// System event sent from Rust to main isolate (cannot be spoofed by workers)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemEvent {
    pub event_type: String,
    pub isolate_id: usize,
    pub data: serde_json::Value,
}

#[op2(async)]
#[number]
pub async fn op_sandbox_create_isolate(
    state: Rc<RefCell<OpState>>,
) -> Result<usize, deno_core::error::CoreError> {
    let pool = {
        let state_borrow = state.borrow();
        let pool = state_borrow
            .borrow::<Rc<JsWorkerPool>>()
            .clone();
        pool
    };

    let isolate_id = pool.create_isolate().await
        .map_err(|e| deno_core::error::CoreError::from(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

    Ok(isolate_id)
}

#[op2(fast)]
pub fn op_sandbox_execute(
    state: Rc<RefCell<OpState>>,
    #[number] isolate_id: usize,
    #[string] script: String,
) {
    let pool = {
        let state_borrow = state.borrow();
        state_borrow.borrow::<Rc<JsWorkerPool>>().clone()
    };

    pool.execute_fire_and_forget(isolate_id, script);
}

#[op2(fast)]
pub fn op_sandbox_destroy_isolate(
    state: Rc<RefCell<OpState>>,
    #[number] isolate_id: usize,
) -> Result<(), deno_core::error::CoreError> {
    let pool = {
        let state_borrow = state.borrow();
        state_borrow.borrow::<Rc<JsWorkerPool>>().clone()
    };

    pool.destroy_isolate(isolate_id)
        .map_err(|e| deno_core::error::CoreError::from(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

    Ok(())
}

#[op2(fast)]
#[number]
pub fn op_sandbox_thread_count(
    state: Rc<RefCell<OpState>>,
) -> usize {
    let pool = {
        let state_borrow = state.borrow();
        state_borrow.borrow::<Rc<JsWorkerPool>>().clone()
    };

    pool.thread_count()
}

#[op2(fast)]
#[number]
pub fn op_sandbox_isolate_count(
    state: Rc<RefCell<OpState>>,
) -> usize {
    let pool = {
        let state_borrow = state.borrow();
        state_borrow.borrow::<Rc<JsWorkerPool>>().clone()
    };

    pool.isolate_count()
}

#[op2(fast)]
pub fn op_sandbox_shutdown(
    state: Rc<RefCell<OpState>>,
) {
    let pool = {
        let state_borrow = state.borrow();
        state_borrow.borrow::<Rc<JsWorkerPool>>().clone()
    };

    pool.shutdown();
}

/// Send a message to an isolate via the channel (non-blocking, processed within event loop)
/// This is the fix for the deadlock - messages are sent via channel and received asynchronously
#[op2]
pub fn op_sandbox_send_to_isolate(
    state: Rc<RefCell<OpState>>,
    #[number] isolate_id: usize,
    #[string] event: String,
    #[serde] data: serde_json::Value,
) -> Result<(), deno_core::error::CoreError> {
    let pool = {
        let state_borrow = state.borrow();
        state_borrow.borrow::<Rc<JsWorkerPool>>().clone()
    };

    pool.send_to_isolate(isolate_id, event, data)
        .map_err(|e| deno_core::error::CoreError::from(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

    Ok(())
}


/// Message with isolate ID for routing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsolateMessageWithId {
    pub isolate_id: usize,
    pub event: String,
    pub data: serde_json::Value,
}

#[op2(async)]
#[serde]
pub async fn op_sandbox_poll_messages(
    state: Rc<RefCell<OpState>>,
) -> Result<Vec<IsolateMessageWithId>, deno_core::error::CoreError> {
    use tokio::sync::mpsc;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    // Get the Arc<Mutex<Receiver>> from OpState
    let receiver = {
        let state_borrow = state.borrow();
        match state_borrow.try_borrow::<Arc<Mutex<mpsc::UnboundedReceiver<(usize, IsolateMessage)>>>>() {
            Some(rx) => rx.clone(),
            None => return Ok(Vec::new()), // Receiver not yet initialized
        }
    };

    // Lock the receiver (this is async-safe and won't block other JS tasks)
    let mut rx = receiver.lock().await;

    // Collect all available messages without blocking
    let mut messages = Vec::new();
    while let Ok((isolate_id, msg)) = rx.try_recv() {
        messages.push(IsolateMessageWithId {
            isolate_id,
            event: msg.event,
            data: msg.data,
        });
    }

    // If no messages yet, wait for at least one (this properly yields to the event loop)
    if messages.is_empty() {
        if let Some((isolate_id, msg)) = rx.recv().await {
            messages.push(IsolateMessageWithId {
                isolate_id,
                event: msg.event,
                data: msg.data,
            });
        }
    }

    Ok(messages)
}

/// Poll system events (secure, cannot be spoofed by workers)
/// Only available in privileged main isolate
#[op2(async)]
#[serde]
pub async fn op_sandbox_poll_system_events(
    state: Rc<RefCell<OpState>>,
) -> Result<Vec<SystemEvent>, deno_core::error::CoreError> {
    use tokio::sync::mpsc;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    // Get the Arc<Mutex<Receiver>> from OpState
    let receiver = {
        let state_borrow = state.borrow();
        match state_borrow.try_borrow::<Arc<Mutex<mpsc::UnboundedReceiver<SystemEvent>>>>() {
            Some(rx) => rx.clone(),
            None => return Ok(Vec::new()), // Receiver not yet initialized
        }
    };

    // Lock the receiver (this is async-safe and won't block other JS tasks)
    let mut rx = receiver.lock().await;

    // Collect all available system events without blocking
    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
        events.push(event);
    }

    // If no events yet, wait for one (this properly yields to the event loop)
    if events.is_empty() {
        if let Some(event) = rx.recv().await {
            events.push(event);
        }
    }

    Ok(events)
}
