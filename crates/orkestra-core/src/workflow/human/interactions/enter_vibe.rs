//! Transition a task into vibe mode from `AwaitingApproval` or Done.

use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use orkestra_types::config::VIBE_STAGE;
use orkestra_types::domain::VibeOrigin;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    // Validate state: must be AwaitingApproval or Done
    let is_awaiting_approval = matches!(task.state, TaskState::AwaitingApproval { .. });
    let is_done = matches!(task.state, TaskState::Done);

    if !is_awaiting_approval && !is_done {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot enter vibe mode from state {} (expected AwaitingApproval or Done)",
            task.state
        )));
    }

    // Validate worktree is available
    if task.worktree_path.is_none() {
        return Err(WorkflowError::InvalidState(
            "Cannot enter vibe: worktree not available".into(),
        ));
    }

    // Prevent re-entry if already vibing
    if task.vibe_origin.is_some() {
        return Err(WorkflowError::InvalidTransition(
            "Task is already in vibe mode".into(),
        ));
    }

    // Record origin
    let current_stage = task.current_stage().map(String::from);
    let origin = VibeOrigin {
        flow: task.flow.clone(),
        stage: if is_awaiting_approval {
            current_stage.clone()
        } else {
            None
        },
        proposed_destination: None,
    };
    task.vibe_origin = Some(origin);

    // End current iteration if entering from AwaitingApproval
    if is_awaiting_approval {
        if let Some(ref stage) = current_stage {
            iteration_service.end_iteration(
                &task.id,
                stage,
                Outcome::Skipped {
                    stage: stage.clone(),
                    reason: "Entered vibe mode".into(),
                },
            )?;
        }
    }

    // Clear completed_at when entering from Done
    if is_done {
        task.completed_at = None;
    }

    // Transition to queued for vibe stage
    task.state = TaskState::queued(VIBE_STAGE);

    // Create iteration for vibe stage
    iteration_service.create_iteration(&task.id, VIBE_STAGE, None)?;

    store.save_task(&task)?;
    Ok(task)
}
