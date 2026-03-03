//! Kill the running chat agent process for a task.
//!
//! Kills the process tree and clears the PID. Does not change chat mode state —
//! call `return_to_work` to exit chat mode and transition the task.

use crate::orkestra_debug;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use orkestra_process::{is_process_running, kill_process_tree};

/// Kill the running chat agent for a task and clear the PID.
///
/// Does not change chat mode — call `return_to_work` to exit chat mode
/// and create a new iteration for the agent.
pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<()> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| crate::workflow::ports::WorkflowError::TaskNotFound(task_id.into()))?;

    let stage = match task.current_stage() {
        Some(s) => s.to_string(),
        None => return Ok(()), // No active stage, nothing to stop
    };

    let session = store.get_stage_session(task_id, &stage)?;
    if let Some(mut session) = session {
        if let Some(pid) = session.agent_pid {
            if is_process_running(pid) {
                orkestra_debug!("stage_chat", "Killing chat agent (pid={})", pid);
                if let Err(e) = kill_process_tree(pid) {
                    orkestra_debug!(
                        "stage_chat",
                        "Failed to kill chat agent (pid={}): {}",
                        pid,
                        e
                    );
                }
            }
            let now = chrono::Utc::now().to_rfc3339();
            session.agent_finished(&now);
            store.save_stage_session(&session)?;
        }
    }

    Ok(())
}
