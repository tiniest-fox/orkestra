//! Create a new subtask under a parent task.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{extract_short_id, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    parent_id: &str,
    title: &str,
    description: &str,
) -> WorkflowResult<Task> {
    // Verify parent exists and its setup is complete
    let parent = store
        .get_task(parent_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(parent_id.into()))?;

    if matches!(
        parent.state,
        TaskState::AwaitingSetup { .. } | TaskState::SettingUp { .. }
    ) {
        return Err(WorkflowError::InvalidTransition(
            "Cannot create subtask while parent task is still setting up".into(),
        ));
    }

    let id = store.next_subtask_id(parent_id)?;
    let first_stage = workflow
        .first_stage(&parent.flow)
        .ok_or_else(|| WorkflowError::InvalidTransition("No stages in workflow".into()))?;

    let short_id = extract_short_id(&id);

    let now = chrono::Utc::now().to_rfc3339();
    let mut task = Task::new(&id, title, description, &first_stage.name, &now);
    task.parent_id = Some(parent_id.to_string());
    task.short_id = Some(short_id);

    // Subtasks branch from parent's branch (worktree created during setup).
    task.base_branch = parent
        .branch_name
        .clone()
        .unwrap_or_else(|| parent.base_branch.clone());

    // Subtasks inherit parent's auto_mode
    task.auto_mode = parent.auto_mode;

    // Start in AwaitingSetup for consistency with create_task()
    task.state = TaskState::awaiting_setup(&first_stage.name);

    store.save_task(&task)?;

    // Create initial iteration via IterationService
    iteration_service.create_initial_iteration(&id, &first_stage.name)?;

    orkestra_debug!(
        "task",
        "Created subtask {}: parent={}, state={}",
        task.id,
        parent_id,
        task.state
    );

    Ok(task)
}
