//! Claims a pairing code and returns a new bearer token.

use std::sync::{Arc, Mutex};

use rand::RngCore;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::types::AuthError;

/// Claim a pairing code and return a new bearer token.
///
/// Atomically marks the code as claimed (via a single UPDATE with all
/// validity checks), generates a 32-byte random bearer token, stores its
/// SHA-256 hash in `device_tokens`, and returns the raw token. The raw
/// token is shown exactly once and never stored.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    code: &str,
    device_name: &str,
) -> Result<String, AuthError> {
    let conn = conn.lock().map_err(|_| AuthError::Lock)?;

    // Atomic claim: UPDATE only succeeds if code is valid, unclaimed, and not expired.
    let affected = conn
        .execute(
            "UPDATE pairing_codes SET claimed = 1 \
             WHERE code = ? AND claimed = 0 AND expires_at > datetime('now')",
            params![code],
        )
        .map_err(|e| AuthError::Storage(e.to_string()))?;

    if affected == 0 {
        return Err(AuthError::InvalidCode);
    }

    // Code is now atomically claimed — generate token.
    let raw_token = random_token();
    let token_hash = super::sha256_hex(&raw_token);
    let device_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO device_tokens (id, device_name, token_hash) VALUES (?, ?, ?)",
        params![device_id, device_name, token_hash],
    )
    .map_err(|e| AuthError::Storage(e.to_string()))?;

    Ok(raw_token)
}

// -- Helpers --

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
