//! Generates a random 6-digit pairing code with a 5-minute TTL.

use std::sync::{Arc, Mutex};

use rand::RngCore;
use rusqlite::{params, Connection};

use crate::types::AuthError;

/// Generate a random 6-digit pairing code with a 5-minute TTL.
///
/// The daemon calls this to produce a code it can display on stdout.
/// The client then uses that code to claim a bearer token via `pair_device::execute`.
pub fn execute(conn: &Arc<Mutex<Connection>>) -> Result<String, AuthError> {
    let code = random_6_digit_code();

    let conn = conn.lock().map_err(|_| AuthError::Lock)?;
    conn.execute(
        "INSERT INTO pairing_codes (code, expires_at) \
         VALUES (?, datetime('now', '+5 minutes'))",
        params![code],
    )
    .map_err(|e| AuthError::Storage(e.to_string()))?;

    Ok(code)
}

// -- Helpers --

fn random_6_digit_code() -> String {
    let mut rng = rand::thread_rng();
    let n = rng.next_u32() % 1_000_000;
    format!("{n:06}")
}
