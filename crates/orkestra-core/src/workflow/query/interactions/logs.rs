//! Query task logs and stages with logs.

use std::sync::Arc;

use crate::workflow::domain::LogEntry;
use crate::workflow::log_service::LogService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

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

/// Get log entries for a task's stage.
pub fn get_task_logs(
    store: &Arc<dyn WorkflowStore>,
    task_id: &str,
    stage: Option<&str>,
) -> WorkflowResult<Vec<LogEntry>> {
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
