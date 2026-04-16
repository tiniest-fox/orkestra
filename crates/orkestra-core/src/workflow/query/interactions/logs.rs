//! Query task logs and stages with logs.

use std::sync::Arc;

use crate::workflow::domain::LogEntry;
use crate::workflow::log_service::LogService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

/// Get the most recent log entry for the task's current stage session.
///
/// Returns `None` if the task has no current stage, no session for the stage,
/// or the session has no log entries.
///
/// Does NOT enrich `ArtifactProduced` entries with artifact content. This is intentional —
/// the only consumer is `push_summary()` for push notification text, which reads `name` only.
/// If a future consumer needs the full artifact payload, call `enrich_artifact_entries` after.
pub fn get_latest_log_for_task(
    store: &Arc<dyn WorkflowStore>,
    task_id: &str,
) -> WorkflowResult<Option<LogEntry>> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let Some(stage_name) = task.current_stage() else {
        return Ok(None);
    };

    let Some(session) = store.get_stage_session(task_id, stage_name)? else {
        return Ok(None);
    };

    store.get_latest_log_entry(&session.id)
}

/// Get stages that have logs for a task.
pub fn get_stages_with_logs(
    store: &Arc<dyn WorkflowStore>,
    task_id: &str,
) -> WorkflowResult<Vec<String>> {
    let sessions = store.get_stage_sessions(task_id)?;
    let log_service = LogService::new(Arc::clone(store));

    let mut stages = Vec::new();
    for session in sessions {
        if log_service.has_logs(&session.id)? {
            stages.push(session.stage);
        }
    }
    Ok(stages)
}

/// Get log entries for a task's stage or a specific session with optional cursor-based pagination.
///
/// If `session_id` is provided, fetch logs for that specific session.
/// Otherwise, if `stage` is provided, fetch logs for the current session of that stage.
/// If neither is provided, fetch logs for the current stage's current session.
///
/// When `cursor` is `Some(seq)`, only entries with `sequence_number` > seq are returned.
/// When `cursor` is `None`, all entries are returned.
///
/// Returns `(entries, cursor)` where cursor is the max `sequence_number` of the returned
/// entries, or `None` if no entries were returned.
pub fn get_task_logs(
    store: &Arc<dyn WorkflowStore>,
    task_id: &str,
    stage: Option<&str>,
    session_id: Option<&str>,
    cursor: Option<u64>,
) -> WorkflowResult<(Vec<LogEntry>, Option<u64>)> {
    let after_sequence = cursor.unwrap_or(0);

    // If session_id provided, fetch directly
    if let Some(sid) = session_id {
        let log_service = LogService::new(Arc::clone(store));
        let (entries, cursor) = log_service.get_logs_after(sid, after_sequence)?;
        return Ok((enrich_artifact_entries(store, entries)?, cursor));
    }

    // Otherwise, use existing stage-based lookup
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let stage_name = match stage {
        Some(s) => s.to_string(),
        None => match task.current_stage() {
            Some(s) => s.to_string(),
            None => return Ok((vec![], None)),
        },
    };

    let Some(session) = store.get_stage_session(task_id, &stage_name)? else {
        return Ok((vec![], None));
    };

    let log_service = LogService::new(Arc::clone(store));
    let (entries, cursor) = log_service.get_logs_after(&session.id, after_sequence)?;
    Ok((enrich_artifact_entries(store, entries)?, cursor))
}

/// Populate the `artifact` field on `ArtifactProduced` log entries.
///
/// Fetches each referenced artifact from the store so the frontend
/// receives the full content without a separate lookup.
fn enrich_artifact_entries(
    store: &Arc<dyn WorkflowStore>,
    mut entries: Vec<LogEntry>,
) -> WorkflowResult<Vec<LogEntry>> {
    for entry in &mut entries {
        if let LogEntry::ArtifactProduced {
            artifact_id,
            artifact,
            ..
        } = entry
        {
            if artifact.is_none() {
                *artifact = store.get_artifact(artifact_id)?;
            }
        }
    }
    Ok(entries)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::api::WorkflowApi;
    use crate::workflow::config::{StageConfig, WorkflowConfig};
    use crate::workflow::domain::{StageSession, WorkflowArtifact};
    use crate::workflow::runtime::TaskState;
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![StageConfig::new("planning", "plan")])
    }

    #[test]
    fn returns_none_when_task_has_no_current_stage() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(test_workflow(), Arc::clone(&store));

        let mut task = api.create_task("Test", "Desc", None).unwrap();
        task.state = TaskState::Done;
        api.store.save_task(&task).unwrap();

        let result = get_latest_log_for_task(&api.store, &task.id).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_when_no_session_for_stage() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(test_workflow(), Arc::clone(&store));

        // Task has current stage "planning" but no session saved.
        let task = api.create_task("Test", "Desc", None).unwrap();

        let result = get_latest_log_for_task(&api.store, &task.id).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn returns_latest_entry_when_session_has_logs() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(test_workflow(), Arc::clone(&store));

        let task = api.create_task("Test", "Desc", None).unwrap();

        let session = StageSession::new(
            format!("{}-planning", task.id),
            &task.id,
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        api.store.save_stage_session(&session).unwrap();

        api.store
            .append_log_entry(
                &session.id,
                &LogEntry::Text {
                    content: "first".to_string(),
                },
                None,
            )
            .unwrap();
        api.store
            .append_log_entry(
                &session.id,
                &LogEntry::Text {
                    content: "latest".to_string(),
                },
                None,
            )
            .unwrap();

        let result = get_latest_log_for_task(&api.store, &task.id).unwrap();
        assert!(result.is_some());
        match result.unwrap() {
            LogEntry::Text { content } => assert_eq!(content, "latest"),
            _ => panic!("unexpected entry type"),
        }
    }

    #[test]
    fn get_task_logs_cursor_none_returns_all_entries() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(test_workflow(), Arc::clone(&store));

        let task = api.create_task("Test", "Desc", None).unwrap();

        let session = StageSession::new(
            format!("{}-planning", task.id),
            &task.id,
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        api.store.save_stage_session(&session).unwrap();

        for i in 1..=3 {
            api.store
                .append_log_entry(
                    &session.id,
                    &LogEntry::Text {
                        content: format!("entry {i}"),
                    },
                    None,
                )
                .unwrap();
        }

        let (entries, cursor) =
            get_task_logs(&api.store, &task.id, Some("planning"), None, None).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(cursor, Some(3));
    }

    #[test]
    fn get_task_logs_cursor_returns_only_new_entries() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(test_workflow(), Arc::clone(&store));

        let task = api.create_task("Test", "Desc", None).unwrap();

        let session = StageSession::new(
            format!("{}-planning", task.id),
            &task.id,
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        api.store.save_stage_session(&session).unwrap();

        for i in 1..=4 {
            api.store
                .append_log_entry(
                    &session.id,
                    &LogEntry::Text {
                        content: format!("entry {i}"),
                    },
                    None,
                )
                .unwrap();
        }

        // Fetch first 2 entries (cursor=0 → all; then use returned cursor=4 for next)
        let (entries_first, cursor_first) =
            get_task_logs(&api.store, &task.id, Some("planning"), None, None).unwrap();
        assert_eq!(entries_first.len(), 4);
        assert_eq!(cursor_first, Some(4));

        // Append one more entry
        api.store
            .append_log_entry(
                &session.id,
                &LogEntry::Text {
                    content: "entry 5".into(),
                },
                None,
            )
            .unwrap();

        // Fetch since cursor=4 — should only get entry 5
        let (entries_second, cursor_second) =
            get_task_logs(&api.store, &task.id, Some("planning"), None, cursor_first).unwrap();
        assert_eq!(entries_second.len(), 1);
        match &entries_second[0] {
            LogEntry::Text { content } => assert_eq!(content, "entry 5"),
            _ => panic!("unexpected entry type"),
        }
        assert_eq!(cursor_second, Some(5));
    }

    #[test]
    fn get_task_logs_cursor_beyond_max_returns_empty() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(test_workflow(), Arc::clone(&store));

        let task = api.create_task("Test", "Desc", None).unwrap();

        let session = StageSession::new(
            format!("{}-planning", task.id),
            &task.id,
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        api.store.save_stage_session(&session).unwrap();

        api.store
            .append_log_entry(
                &session.id,
                &LogEntry::Text {
                    content: "entry 1".into(),
                },
                None,
            )
            .unwrap();

        let (entries, cursor) =
            get_task_logs(&api.store, &task.id, Some("planning"), None, Some(999)).unwrap();
        assert!(entries.is_empty());
        assert!(cursor.is_none());
    }

    #[test]
    fn get_task_logs_enriches_artifact_produced_entries() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(test_workflow(), Arc::clone(&store));

        let task = api.create_task("Test", "Desc", None).unwrap();

        let session = StageSession::new(
            format!("{}-planning", task.id),
            &task.id,
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        api.store.save_stage_session(&session).unwrap();

        // Save an artifact in the store.
        let artifact = WorkflowArtifact::new(
            "art-1",
            &task.id,
            "planning",
            "plan",
            "# Plan\n\nDo the thing.",
            "2025-01-24T10:00:00Z",
        );
        api.store.save_artifact(&artifact).unwrap();

        // Append an ArtifactProduced log entry referencing that artifact.
        api.store
            .append_log_entry(
                &session.id,
                &LogEntry::ArtifactProduced {
                    name: "plan".to_string(),
                    artifact_id: "art-1".to_string(),
                    artifact: None,
                },
                None,
            )
            .unwrap();

        let (entries, _) =
            get_task_logs(&api.store, &task.id, Some("planning"), None, None).unwrap();
        assert_eq!(entries.len(), 1);

        match &entries[0] {
            LogEntry::ArtifactProduced {
                name,
                artifact_id,
                artifact: Some(enriched),
            } => {
                assert_eq!(name, "plan");
                assert_eq!(artifact_id, "art-1");
                assert_eq!(enriched.content, "# Plan\n\nDo the thing.");
            }
            other => panic!("Expected enriched ArtifactProduced entry, got: {other:?}"),
        }
    }

    #[test]
    fn get_task_logs_artifact_produced_missing_artifact_returns_none() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(test_workflow(), Arc::clone(&store));

        let task = api.create_task("Test", "Desc", None).unwrap();

        let session = StageSession::new(
            format!("{}-planning", task.id),
            &task.id,
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        api.store.save_stage_session(&session).unwrap();

        // Append an ArtifactProduced log entry with a non-existent artifact_id.
        api.store
            .append_log_entry(
                &session.id,
                &LogEntry::ArtifactProduced {
                    name: "plan".to_string(),
                    artifact_id: "missing-art-id".to_string(),
                    artifact: None,
                },
                None,
            )
            .unwrap();

        let (entries, _) =
            get_task_logs(&api.store, &task.id, Some("planning"), None, None).unwrap();
        assert_eq!(entries.len(), 1);

        match &entries[0] {
            LogEntry::ArtifactProduced {
                artifact_id,
                artifact: None,
                ..
            } => {
                assert_eq!(artifact_id, "missing-art-id");
            }
            other => panic!("Expected ArtifactProduced with artifact: None, got: {other:?}"),
        }
    }
}
