//! E2E tests for assistant session lifecycle.
//!
//! Tests assistant session creation, log storage, and session isolation
//! using real `SQLite` persistence (no mocks).

use orkestra_core::workflow::domain::LogEntry;

use crate::helpers::create_assistant_service;

// =============================================================================
// Session Lifecycle
// =============================================================================

#[test]
fn test_assistant_session_lifecycle() {
    let (service, _store, _temp_dir) = create_assistant_service();

    // Step 1: Create first session
    let session1 = service
        .send_message(None, "What tasks are active?")
        .unwrap();
    assert!(!session1.id.is_empty());
    assert!(session1.claude_session_id.is_some());

    // Step 2: Verify user message stored
    let logs1 = service.get_session_logs(&session1.id).unwrap();
    // Should have at least the user message (may also have spawn error since CLI isn't available)
    assert!(!logs1.is_empty());
    let has_user_msg = logs1.iter().any(|e| {
        matches!(e, LogEntry::UserMessage { content, .. } if content == "What tasks are active?")
    });
    assert!(has_user_msg, "User message should be stored as log entry");

    // Step 3: Create second session
    let session2 = service
        .send_message(None, "Show me the codebase structure")
        .unwrap();
    assert_ne!(
        session1.id, session2.id,
        "Sessions should have distinct IDs"
    );
    assert_ne!(
        session1.claude_session_id, session2.claude_session_id,
        "Sessions should have distinct Claude session IDs"
    );

    // Step 4: Verify both sessions in list
    let all_sessions = service.list_sessions().unwrap();
    assert_eq!(all_sessions.len(), 2, "Should have exactly 2 sessions");
    // Most recent first
    assert_eq!(all_sessions[0].id, session2.id);
    assert_eq!(all_sessions[1].id, session1.id);

    // Step 5: Verify session isolation
    let logs1 = service.get_session_logs(&session1.id).unwrap();
    let logs2 = service.get_session_logs(&session2.id).unwrap();

    // Each session should only have its own messages
    let log1_messages: Vec<_> = logs1
        .iter()
        .filter_map(|e| match e {
            LogEntry::UserMessage { content, .. } => Some(content.as_str()),
            _ => None,
        })
        .collect();
    let log2_messages: Vec<_> = logs2
        .iter()
        .filter_map(|e| match e {
            LogEntry::UserMessage { content, .. } => Some(content.as_str()),
            _ => None,
        })
        .collect();

    assert_eq!(log1_messages, vec!["What tasks are active?"]);
    assert_eq!(log2_messages, vec!["Show me the codebase structure"]);

    // Step 6: Verify empty message rejection
    let empty_result = service.send_message(None, "");
    assert!(empty_result.is_err());
    let whitespace_result = service.send_message(None, "   ");
    assert!(whitespace_result.is_err());
    // No new sessions should have been created
    assert_eq!(service.list_sessions().unwrap().len(), 2);
}

// =============================================================================
// ProcessExit Log Entry
// =============================================================================

#[test]
fn test_process_exit_log_entry_round_trips() {
    let (service, store, _temp_dir) = create_assistant_service();

    // Step 1: Create a session (spawn will fail, but we get a session with logs)
    let session = service
        .send_message(None, "test message")
        .expect("should create session");

    // Step 2: Append ProcessExit log entry with code: None
    store
        .append_assistant_log_entry(&session.id, &LogEntry::ProcessExit { code: None })
        .expect("should append ProcessExit entry");

    // Step 3: Verify it round-trips as the last entry
    let logs = service
        .get_session_logs(&session.id)
        .expect("should retrieve logs");
    assert!(!logs.is_empty(), "Should have log entries");

    let last_entry = logs.last().expect("Should have at least one log entry");
    assert!(
        matches!(last_entry, LogEntry::ProcessExit { code: None }),
        "Last entry should be ProcessExit with code: None, got: {last_entry:?}"
    );

    // Step 4: Also test with code: Some(0)
    store
        .append_assistant_log_entry(&session.id, &LogEntry::ProcessExit { code: Some(0) })
        .expect("should append ProcessExit entry with exit code");

    let logs = service
        .get_session_logs(&session.id)
        .expect("should retrieve logs");
    let last_entry = logs.last().expect("Should have at least one log entry");
    assert!(
        matches!(last_entry, LogEntry::ProcessExit { code: Some(0) }),
        "Last entry should be ProcessExit with code: Some(0), got: {last_entry:?}"
    );
}
