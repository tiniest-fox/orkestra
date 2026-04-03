//! Exit interactive mode — return task to the pipeline or mark as Done.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::integration::interactions::commit_worktree;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use orkestra_process::{is_process_running, kill_process_tree};
use orkestra_types::domain::SessionType;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    git: Option<&dyn GitService>,
    task_id: &str,
    target_stage: Option<&str>,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let current_stage = match &task.state {
        TaskState::Interactive { stage } => stage.clone(),
        _ => {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot exit interactive mode from state {} (expected Interactive)",
                task.state
            )));
        }
    };

    orkestra_debug!(
        "action",
        "exit_interactive {}: stage={}, target={:?}",
        task_id,
        current_stage,
        target_stage
    );

    let now = chrono::Utc::now().to_rfc3339();

    // Kill the interactive session's agent process if running
    if let Ok(Some(mut session)) =
        store.get_assistant_session_for_task(task_id, &SessionType::Interactive)
    {
        if let Some(pid) = session.agent_pid {
            if is_process_running(pid) {
                orkestra_debug!(
                    "action",
                    "exit_interactive {}: killing interactive agent pid={}",
                    task_id,
                    pid
                );
                if let Err(e) = kill_process_tree(pid) {
                    orkestra_debug!(
                        "action",
                        "exit_interactive {}: failed to kill pid={}: {}",
                        task_id,
                        pid,
                        e
                    );
                }
            }
        }

        // Mark the interactive session as completed
        session.complete(&now);
        store.save_assistant_session(&session)?;
    }

    // Commit any pending worktree changes with a simple deterministic message.
    // Commit failures are intentionally swallowed — the pipeline can still advance
    // without a clean commit (e.g., if the worktree has no changes or git is unavailable).
    // This mirrors the best-effort commit pattern in squash_rebase_merge: log and continue.
    if let Some(git) = git {
        if let Err(e) = commit_worktree::execute(git, &task, &current_stage, None, None) {
            orkestra_debug!(
                "action",
                "exit_interactive {}: commit failed: {}",
                task_id,
                e
            );
        }
    }

    // Create a new iteration with ReturnFromInteractive trigger
    iteration_service.create_iteration(
        task_id,
        &current_stage,
        Some(IterationTrigger::ReturnFromInteractive),
    )?;

    orkestra_debug!(
        "action",
        "exit_interactive {}: created iteration for stage={}",
        task_id,
        current_stage
    );

    // Validate and transition state based on target_stage
    if let Some(stage) = target_stage {
        if !workflow.has_stage(&task.flow, stage) {
            return Err(WorkflowError::InvalidTransition(format!(
                "Stage '{stage}' is not in the task's flow"
            )));
        }
        task.state = TaskState::queued(stage);
    } else {
        task.state = TaskState::Done;
        task.completed_at = Some(now.clone());
    }

    task.updated_at = now;
    store.save_task(&task)?;
    Ok(task)
}
