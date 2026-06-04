//! Integration tests for the PTY execution engine.
//!
//! Covers: `claude-pty` registry routing, regression checks on `claudecode` routing,
//! hook server event delivery, and a full PTY lifecycle smoke test.
#![cfg(unix)]

use std::io::Write;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use orkestra_agent::interactions::agent::run_pty;
use orkestra_agent::{
    default_test_registry, start_hook_server, HookEventType, RunConfig, RunEvent,
};
use tempfile::TempDir;

// ============================================================================
// Test 1: Full PTY lifecycle
// ============================================================================

/// Full PTY lifecycle: spawn mock claude, inject prompt, collect JSONL, emit `RunEvent::Completed`.
///
/// Ignored by default — requires:
/// - A Unix PTY (macOS or Linux with /dev/pts)
/// - `bash` in PATH
/// - `python3` in PATH
///
/// Run with: `cargo test -p orkestra-agent -- --ignored pty_provider_full_lifecycle`
#[test]
#[ignore = "requires PTY support and Python3; run with --ignored on a developer machine"]
fn pty_provider_full_lifecycle() {
    use std::collections::HashMap;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc::RecvTimeoutError;

    let tmp = TempDir::new().unwrap();

    // Start hook server in the temp dir so the socket lives there
    let hook_server = Arc::new(start_hook_server(tmp.path()).unwrap());

    // Create a temp bin dir and copy the mock claude script into it as "claude"
    let bin_dir = tmp.path().join("bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    let fixtures_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let claude_bin = bin_dir.join("claude");
    std::fs::copy(fixtures_dir.join("mock_claude_pty.sh"), &claude_bin).unwrap();
    let mut perms = std::fs::metadata(&claude_bin).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&claude_bin, perms).unwrap();

    // Override PATH so the PTY child process finds our mock claude
    let mut env_override = HashMap::new();
    env_override.insert(
        "PATH".to_string(),
        format!(
            "{}:{}",
            bin_dir.display(),
            std::env::var("PATH").unwrap_or_default()
        ),
    );

    let registry = Arc::new(default_test_registry());
    let config = RunConfig::new(
        tmp.path(),
        "Test prompt",
        r#"{"type":"object","properties":{"type":{"type":"string"},"content":{"type":"string"}},"required":["type","content"]}"#,
    )
    .with_task_id("lifecycle-test")
    .with_model("claude-pty/sonnet")
    .with_env(env_override);

    let (pid, rx) = run_pty::execute(&registry, &config, &hook_server).unwrap();
    assert!(pid > 0, "PTY process must have a valid PID");

    // Collect events until Completed arrives or 30s elapses
    let mut events: Vec<RunEvent> = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining.min(Duration::from_millis(500))) {
            Ok(event) => {
                let done = matches!(event, RunEvent::Completed(_));
                events.push(event);
                if done {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    assert!(
        events.iter().any(|e| matches!(e, RunEvent::LogLine(_))),
        "expected at least one LogLine event; events received: {events:?}"
    );

    let completed = events.iter().find(|e| matches!(e, RunEvent::Completed(_)));
    assert!(
        completed.is_some(),
        "no Completed event received within 30s (events: {events:?})"
    );

    if let Some(RunEvent::Completed(result)) = completed {
        assert!(
            result.is_ok(),
            "expected Completed(Ok), got Completed(Err({result:?}))"
        );
    }
}

// ============================================================================
// Test 2: Registry routing
// ============================================================================

/// `claude-pty/<model>` prefix routes to the `claude-pty` provider with correct capabilities.
#[test]
fn claude_pty_routing_works() {
    let registry = default_test_registry();
    let resolved = registry.resolve(Some("claude-pty/sonnet")).unwrap();
    assert_eq!(resolved.provider_name, "claude-pty");
    assert!(
        !resolved.capabilities.supports_json_schema,
        "claude-pty does not support --json-schema in interactive mode"
    );
    assert!(
        !resolved.capabilities.supports_system_prompt,
        "claude-pty does not support --system in interactive mode"
    );
}

// ============================================================================
// Test 3: Existing headless routing unchanged
// ============================================================================

/// Adding `claude-pty` must not regress `claudecode` routing or bare-alias resolution.
#[test]
fn existing_claudecode_routing_unchanged() {
    let registry = default_test_registry();

    // Explicit claudecode prefix
    let resolved = registry.resolve(Some("claudecode/sonnet")).unwrap();
    assert_eq!(resolved.provider_name, "claudecode");
    assert!(
        resolved.capabilities.supports_json_schema,
        "claudecode supports --json-schema"
    );

    // Bare alias still maps to claudecode
    let resolved = registry.resolve(Some("sonnet")).unwrap();
    assert_eq!(resolved.provider_name, "claudecode");

    // Default (None) still resolves to claudecode
    let resolved = registry.resolve(None).unwrap();
    assert_eq!(resolved.provider_name, "claudecode");
}

// ============================================================================
// Test 4: Hook delivery
// ============================================================================

/// `HookServer` routes a Stop hook payload to the correct per-task receiver.
#[test]
fn hook_triggers_correct_event() {
    let tmp = TempDir::new().unwrap();
    let server = start_hook_server(tmp.path()).unwrap();
    let rx = server.register_task("task-1");

    let payload = r#"{"event":"stop","task_id":"task-1","session_id":"ses-123","transcript_path":"/tmp/test.jsonl"}"#;
    let mut stream = UnixStream::connect(server.socket_path()).expect("connect to hook socket");
    stream.write_all(payload.as_bytes()).expect("write payload");
    drop(stream);

    let event = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("hook event not received within 5s");
    assert!(
        matches!(event.event_type, HookEventType::Stop),
        "expected Stop event, got {:?}",
        event.event_type
    );
    assert_eq!(event.task_id, "task-1");
    assert_eq!(event.session_id, "ses-123");
}
