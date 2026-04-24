//! Promote a chat task to a workflow flow.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use orkestra_process::kill_process_tree;
use orkestra_types::domain::SessionType;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    git_service: Option<&dyn GitService>,
    iteration_service: &IterationService,
    task_id: &str,
    flow: Option<&str>,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_chat {
        return Err(WorkflowError::InvalidTransition(
            "Can only promote chat tasks".into(),
        ));
    }

    // Resolve flow
    let flow_name = flow
        .or_else(|| workflow.first_flow_name())
        .ok_or_else(|| WorkflowError::InvalidTransition("No flows in workflow".into()))?;

    if !workflow.flows.contains_key(flow_name) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Unknown flow \"{flow_name}\""
        )));
    }

    let first_stage = workflow
        .first_stage(flow_name)
        .ok_or_else(|| WorkflowError::InvalidTransition("No stages in flow".into()))?;

    // Resolve base_branch
    let base_branch = match git_service {
        Some(git) => git.current_branch().map_err(|e| {
            WorkflowError::InvalidTransition(format!("Cannot determine base branch: {e}"))
        })?,
        None => String::new(),
    };

    // Stop any active assistant or interactive session before promoting
    for session_type in &[SessionType::Assistant, SessionType::Interactive] {
        if let Ok(Some(session)) = store.get_assistant_session_for_task(task_id, session_type) {
            if let Some(pid) = session.agent_pid {
                orkestra_debug!(
                    "action",
                    "promote_to_flow {}: killing assistant agent (pid={})",
                    task_id,
                    pid
                );
                let _ = kill_process_tree(pid);
            }
        }
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Mutate task into a full workflow task
    task.is_chat = false;
    task.flow = flow_name.to_string();
    task.base_branch = base_branch;
    task.state = TaskState::awaiting_setup(&first_stage.name);
    task.updated_at = now;

    // Create initial iteration for the first stage
    iteration_service.create_initial_iteration(&task.id, &first_stage.name)?;

    store.save_task(&task)?;

    orkestra_debug!(
        "action",
        "Promoted chat task {} to flow '{}', stage '{}'",
        task.id,
        flow_name,
        first_stage.name
    );

    Ok(task)
}
