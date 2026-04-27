//! Promote a chat task to a workflow flow.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use orkestra_process::kill_process_tree;
use orkestra_types::domain::SessionType;
use orkestra_types::runtime::Artifact;

#[allow(clippy::too_many_arguments)]
pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    git_service: Option<&dyn GitService>,
    iteration_service: &IterationService,
    task_id: &str,
    flow: Option<&str>,
    starting_stage: Option<&str>,
    title: Option<&str>,
    artifact_content: Option<&str>,
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

    // Resolve target stage: starting_stage (validated) or first stage
    let target_stage = if let Some(stage_name) = starting_stage {
        workflow.stage(flow_name, stage_name).ok_or_else(|| {
            WorkflowError::InvalidTransition(format!(
                "Stage \"{stage_name}\" not found in flow \"{flow_name}\""
            ))
        })?
    } else {
        workflow
            .first_stage(flow_name)
            .ok_or_else(|| WorkflowError::InvalidTransition("No stages in flow".into()))?
    };

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
    task.state = TaskState::awaiting_setup(&target_stage.name);
    task.updated_at.clone_from(&now);

    // Update title if provided and non-empty
    if let Some(new_title) = title {
        let trimmed = new_title.trim();
        if !trimmed.is_empty() {
            task.title = trimmed.to_string();
        }
    }

    // Store initial artifact if content provided
    if let Some(content) = artifact_content {
        let artifact = Artifact::new(
            target_stage.artifact_name(),
            content,
            &target_stage.name,
            &now,
        );
        task.artifacts.set(artifact);
    }

    // Create initial iteration for the target stage
    iteration_service.create_initial_iteration(&task.id, &target_stage.name)?;

    store.save_task(&task)?;

    orkestra_debug!(
        "action",
        "Promoted chat task {} to flow '{}', stage '{}'",
        task.id,
        flow_name,
        target_stage.name
    );

    Ok(task)
}
