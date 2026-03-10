//! E2E tests for assistant session lifecycle.
//!
//! Tests assistant session creation, log storage, and session isolation
//! using real `SQLite` persistence (no mocks).

use orkestra_core::workflow::domain::{LogEntry, Task};
use orkestra_core::workflow::ports::WorkflowStore;

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

// =============================================================================
// Task-scoped Session Lifecycle
// =============================================================================

#[test]
fn test_task_assistant_session_lifecycle() {
    let (service, store, temp_dir) = create_assistant_service();

    // Create a task with worktree_path pointing to the temp dir
    let task_id = "test-task-abc";
    let worktree_path = temp_dir.path().to_str().unwrap().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut task = Task::new(
        task_id,
        "Test Task Title",
        "A description of the test task.",
        "work",
        &now,
    );
    task.worktree_path = Some(worktree_path);
    store.save_task(&task).expect("save_task should succeed");

    // Step 1: Send a message — creates a new session
    let session1 = service
        .send_task_message(task_id, "hello")
        .expect("send_task_message should succeed");

    // Verify task_id is set on the session
    assert_eq!(
        session1.task_id.as_deref(),
        Some(task_id),
        "Session should be scoped to the task"
    );
    assert!(!session1.id.is_empty());

    // Step 2: Send another message — verify same session is reused
    let session2 = service
        .send_task_message(task_id, "follow-up question")
        .expect("second send_task_message should succeed");

    assert_eq!(
        session1.id, session2.id,
        "Same session should be reused for subsequent messages"
    );

    // Step 3: Verify list_project_sessions does NOT include the task session
    let project_sessions = service
        .list_project_sessions()
        .expect("list_project_sessions should succeed");
    let task_in_project = project_sessions.iter().any(|s| s.id == session1.id);
    assert!(
        !task_in_project,
        "Task session should NOT appear in project sessions list"
    );

    // Step 4: Verify list_sessions DOES include it
    let all_sessions = service
        .list_sessions()
        .expect("list_sessions should succeed");
    let task_in_all = all_sessions.iter().any(|s| s.id == session1.id);
    assert!(
        task_in_all,
        "Task session SHOULD appear in full sessions list"
    );
}
