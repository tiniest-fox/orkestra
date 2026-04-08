//! Query task logs and stages with logs.

use std::sync::Arc;

use crate::workflow::domain::LogEntry;
use crate::workflow::log_service::LogService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

/// Get the most recent log entry for the task's current stage session.
///
/// Returns `None` if the task has no current stage, no session for the stage,
/// or the session has no log entries.
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

/// Get log entries for a task's stage or a specific session.
///
/// If `session_id` is provided, fetch logs for that specific session.
/// Otherwise, if `stage` is provided, fetch logs for the current session of that stage.
/// If neither is provided, fetch logs for the current stage's current session.
pub fn get_task_logs(
    store: &Arc<dyn WorkflowStore>,
    task_id: &str,
    stage: Option<&str>,
    session_id: Option<&str>,
) -> WorkflowResult<Vec<LogEntry>> {
    // If session_id provided, fetch directly
    if let Some(sid) = session_id {
        let log_service = LogService::new(Arc::clone(store));
        return log_service.get_logs(sid);
    }

    // Otherwise, use existing stage-based lookup
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let stage_name = match stage {
        Some(s) => s.to_string(),
        None => match task.current_stage() {
            Some(s) => s.to_string(),
            None => return Ok(vec![]),
        },
    };

    let Some(session) = store.get_stage_session(task_id, &stage_name)? else {
        return Ok(vec![]);
    };

    let log_service = LogService::new(Arc::clone(store));
    log_service.get_logs(&session.id)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::api::WorkflowApi;
    use crate::workflow::config::{StageConfig, WorkflowConfig};
    use crate::workflow::domain::StageSession;
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
}
