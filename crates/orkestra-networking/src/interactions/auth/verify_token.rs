//! Verify a bearer token and return device information.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};
use subtle::ConstantTimeEq;

use crate::types::{AuthError, PairedDevice};

/// Verify a bearer token against stored device token hashes.
///
/// Hashes the provided token with SHA-256, finds a matching non-revoked record,
/// updates `last_used_at`, and returns device information. Uses constant-time
/// comparison to prevent timing-based token enumeration.
pub fn execute(conn: &Arc<Mutex<Connection>>, token: &str) -> Result<PairedDevice, AuthError> {
    let computed_hash = super::sha256_hex(token);

    let conn = conn.lock().map_err(|_| AuthError::Lock)?;

    // Fetch all non-revoked token hashes for constant-time comparison.
    let mut stmt = conn
        .prepare(
            "SELECT id, device_name, token_hash, created_at, last_used_at \
             FROM device_tokens WHERE revoked = 0",
        )
        .map_err(|e| AuthError::Storage(e.to_string()))?;

    let rows: Vec<(String, String, String, String, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| AuthError::Storage(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AuthError::Storage(e.to_string()))?;

    // Use constant-time comparison to find the matching device.
    // The loop must not short-circuit — scanning all rows unconditionally
    // prevents timing attacks that could reveal a token's position.
    let mut matched: Option<(String, String, String, String, Option<String>)> = None;
    for row in rows {
        let is_match: bool = computed_hash.as_bytes().ct_eq(row.2.as_bytes()).into();
        if is_match {
            matched = Some(row);
        }
    }

    let (id, device_name, _, created_at, last_used_at) = matched.ok_or(AuthError::InvalidToken)?;

    // Update last_used_at.
    conn.execute(
        "UPDATE device_tokens SET last_used_at = datetime('now') WHERE id = ?",
        params![id],
    )
    .map_err(|e| AuthError::Storage(e.to_string()))?;

    Ok(PairedDevice {
        id,
        device_name,
        created_at,
        last_used_at,
    })
}
