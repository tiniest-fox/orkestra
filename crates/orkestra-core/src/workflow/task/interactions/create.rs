//! Create a new top-level task.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{Task, TaskCreationMode};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

#[allow(clippy::too_many_arguments)]
pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    git_service: Option<&dyn GitService>,
    iteration_service: &IterationService,
    title: &str,
    description: &str,
    base_branch: Option<&str>,
    mode: TaskCreationMode,
    flow: Option<&str>,
) -> WorkflowResult<Task> {
    // Validate flow exists if specified
    if let Some(flow_name) = flow {
        if !workflow.flows.contains_key(flow_name) {
            return Err(WorkflowError::InvalidTransition(format!(
                "Unknown flow \"{flow_name}\". Available flows: {:?}",
                workflow.flows.keys().collect::<Vec<_>>()
            )));
        }
    }

    let flow_name = flow
        .or_else(|| workflow.first_flow_name())
        .unwrap_or("default");

    let id = store.next_task_id()?;
    let first_stage = workflow
        .first_stage(flow_name)
        .ok_or_else(|| WorkflowError::InvalidTransition("No stages in workflow".into()))?;

    // Resolve base_branch eagerly: use provided value, or current branch from git.
    let resolved_base_branch = match base_branch {
        Some(b) => b.to_string(),
        None => match git_service {
            Some(git) => git.current_branch().map_err(|e| {
                WorkflowError::InvalidTransition(format!("Cannot determine base branch: {e}"))
            })?,
            None => String::new(),
        },
    };

    let now = chrono::Utc::now().to_rfc3339();
    let mut task = Task::new(&id, title, description, &first_stage.name, &now);
    task.base_branch = resolved_base_branch;
    task.auto_mode = matches!(mode, TaskCreationMode::AutoMode);
    task.flow = flow_name.to_string();

    // Start in AwaitingSetup - orchestrator will pick this up and trigger setup
    task.state = TaskState::awaiting_setup(&first_stage.name);

    // Save task immediately (non-blocking UI)
    store.save_task(&task)?;

    // Create initial iteration via IterationService
    iteration_service.create_initial_iteration(&id, &first_stage.name)?;

    orkestra_debug!(
        "task",
        "Created {}: state={}, stage={}",
        task.id,
        task.state,
        first_stage.name
    );

    Ok(task)
}
