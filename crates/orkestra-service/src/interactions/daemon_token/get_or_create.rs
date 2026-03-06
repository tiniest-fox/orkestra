//! Get or create a per-device bearer token for a daemon project.
//!
//! Implements the auto-pairing flow: check the local `daemon_tokens` cache,
//! and if no token exists, generate one by calling the daemon's `/pairing-code`
//! and `/pair` HTTP endpoints, then cache the result.

use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Project, ServiceError};

/// Return a cached daemon token for `device_id`+`project`, or auto-pair with
/// the daemon to create one.
///
/// A per-daemon `pairing_lock` serialises concurrent callers so only one
/// pairing flow runs at a time per daemon.
pub async fn execute(
    conn: &Arc<Mutex<Connection>>,
    device_id: &str,
    project: &Project,
    pairing_lock: Arc<tokio::sync::Mutex<()>>,
) -> Result<String, ServiceError> {
    // Fast path: token already cached.
    {
        let conn_c = Arc::clone(conn);
        let dev_id = device_id.to_string();
        let proj_id = project.id.clone();
        let cached = tokio::task::spawn_blocking(move || lookup_cached(&conn_c, &dev_id, &proj_id))
            .await
            .map_err(|e| ServiceError::Other(e.to_string()))??;
        if let Some(token) = cached {
            return Ok(token);
        }
    }

    // Acquire per-daemon lock to prevent concurrent duplicate pairing.
    let _guard = pairing_lock.lock().await;

    // Double-checked locking: another caller may have populated the cache
    // while we were waiting for the lock.
    {
        let conn_c = Arc::clone(conn);
        let dev_id = device_id.to_string();
        let proj_id = project.id.clone();
        let cached = tokio::task::spawn_blocking(move || lookup_cached(&conn_c, &dev_id, &proj_id))
            .await
            .map_err(|e| ServiceError::Other(e.to_string()))??;
        if let Some(token) = cached {
            return Ok(token);
        }
    }

    let token = pair_with_daemon(project, device_id).await?;

    {
        let conn_c = Arc::clone(conn);
        let dev_id = device_id.to_string();
        let proj_id = project.id.clone();
        let tok = token.clone();
        tokio::task::spawn_blocking(move || cache_token(&conn_c, &dev_id, &proj_id, &tok))
            .await
            .map_err(|e| ServiceError::Other(e.to_string()))??;
    }

    Ok(token)
}

// -- Helpers --

/// Look up an existing token for (`device_id`, `project_id`) in `daemon_tokens`.
fn lookup_cached(
    conn: &Arc<Mutex<Connection>>,
    device_id: &str,
    project_id: &str,
) -> Result<Option<String>, ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    let result = guard
        .query_row(
            "SELECT token FROM daemon_tokens WHERE device_id = ? AND project_id = ?",
            params![device_id, project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(ServiceError::Database)?;
    Ok(result)
}

/// Store a token in `daemon_tokens`, replacing any existing entry.
fn cache_token(
    conn: &Arc<Mutex<Connection>>,
    device_id: &str,
    project_id: &str,
    token: &str,
) -> Result<(), ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    guard.execute(
        "INSERT INTO daemon_tokens (device_id, project_id, token) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(device_id, project_id) DO UPDATE SET token = excluded.token",
        params![device_id, project_id, token],
    )?;
    Ok(())
}

/// Drive the pairing flow against a running daemon:
/// 1. `POST /pairing-code` with Basic auth (empty user, `shared_secret` password)
/// 2. `POST /pair` with the returned code
/// Returns the new bearer token.
async fn pair_with_daemon(project: &Project, device_id: &str) -> Result<String, ServiceError> {
    let base_url = format!("http://127.0.0.1:{}", project.daemon_port);
    let client = reqwest::Client::new();

    // Build Basic auth header: base64(":" + shared_secret)
    let credentials = format!(":{}", project.shared_secret);
    let encoded = BASE64_STANDARD.encode(credentials.as_bytes());
    let auth_header = format!("Basic {encoded}");

    // Step 1: get a pairing code from the daemon.
    let code_response = client
        .post(format!("{base_url}/pairing-code"))
        .header("Authorization", &auth_header)
        .send()
        .await
        .map_err(|e| {
            ServiceError::Other(format!(
                "Failed to reach daemon at port {}: {e}",
                project.daemon_port
            ))
        })?;

    if !code_response.status().is_success() {
        return Err(ServiceError::Other(format!(
            "Daemon /pairing-code returned status {}",
            code_response.status()
        )));
    }

    let code_body: serde_json::Value = code_response
        .json()
        .await
        .map_err(|e| ServiceError::Other(format!("Failed to parse /pairing-code response: {e}")))?;

    let code = code_body["code"]
        .as_str()
        .ok_or_else(|| ServiceError::Other("Daemon /pairing-code response missing `code`".into()))?
        .to_string();

    // Step 2: claim the code and get a bearer token.
    let device_name = format!("service-auto-{}", &device_id[..8.min(device_id.len())]);

    let pair_response = client
        .post(format!("{base_url}/pair"))
        .json(&serde_json::json!({
            "code": code,
            "device_name": device_name,
        }))
        .send()
        .await
        .map_err(|e| {
            ServiceError::Other(format!(
                "Failed to reach daemon at port {} for /pair: {e}",
                project.daemon_port
            ))
        })?;

    if !pair_response.status().is_success() {
        return Err(ServiceError::Other(format!(
            "Daemon /pair returned status {}",
            pair_response.status()
        )));
    }

    let pair_body: serde_json::Value = pair_response
        .json()
        .await
        .map_err(|e| ServiceError::Other(format!("Failed to parse /pair response: {e}")))?;

    let token = pair_body["token"]
        .as_str()
        .ok_or_else(|| ServiceError::Other("Daemon /pair response missing `token`".into()))?
        .to_string();

    Ok(token)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::{cache_token, lookup_cached};
    use crate::database::apply_migrations_for_test;

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        apply_migrations_for_test(&c);
        Arc::new(Mutex::new(c))
    }

    #[test]
    fn cache_lookup_roundtrip() {
        let conn = conn();
        let device_id = "device-abc";
        let project_id = "proj-123";
        let token = "bearer-xyz";

        // Nothing cached yet.
        assert!(lookup_cached(&conn, device_id, project_id)
            .unwrap()
            .is_none());

        // Store a token.
        cache_token(&conn, device_id, project_id, token).unwrap();

        // Now it's found.
        assert_eq!(
            lookup_cached(&conn, device_id, project_id)
                .unwrap()
                .as_deref(),
            Some(token)
        );
    }

    #[test]
    fn cache_token_overwrites_existing() {
        let conn = conn();
        cache_token(&conn, "dev1", "proj1", "old-token").unwrap();
        cache_token(&conn, "dev1", "proj1", "new-token").unwrap();
        assert_eq!(
            lookup_cached(&conn, "dev1", "proj1").unwrap().as_deref(),
            Some("new-token")
        );
    }

    #[test]
    fn cache_is_scoped_to_device_and_project() {
        let conn = conn();
        cache_token(&conn, "dev1", "proj1", "tok-a").unwrap();
        cache_token(&conn, "dev2", "proj1", "tok-b").unwrap();
        cache_token(&conn, "dev1", "proj2", "tok-c").unwrap();

        assert_eq!(
            lookup_cached(&conn, "dev1", "proj1").unwrap().as_deref(),
            Some("tok-a")
        );
        assert_eq!(
            lookup_cached(&conn, "dev2", "proj1").unwrap().as_deref(),
            Some("tok-b")
        );
        assert_eq!(
            lookup_cached(&conn, "dev1", "proj2").unwrap().as_deref(),
            Some("tok-c")
        );
    }
}
