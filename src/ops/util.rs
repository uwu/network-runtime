/// Utility ops - stubs and helpers
use deno_core::{op2, OpState, ResourceId};

/// Stub for TLS peer certificate - returns None
/// Required for deno_tls compatibility
#[op2]
#[serde]
pub fn op_tls_peer_certificate(
    _state: &mut OpState,
    #[smi] _rid: ResourceId,
    _detailed: bool,
) -> Option<serde_json::Value> {
    None
}

/// Stub for set_raw - does nothing
/// Required for deno_io compatibility
#[op2(fast)]
pub fn op_set_raw(
    _state: &mut OpState,
    #[smi] _rid: ResourceId,
    _is_raw: bool,
    _cbreak: bool,
) -> Result<(), deno_core::error::CoreError> {
    Ok(())
}
