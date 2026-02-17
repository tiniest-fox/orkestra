//! Record failed integration and return task to recovery stage.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    error: &str,
    conflict_files: &[String],
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_done() && !matches!(task.state, TaskState::Integrating) {
        return Err(WorkflowError::InvalidTransition(
            "Can only fail integration on Done or Integrating task".into(),
        ));
    }

    // Record integration failure via IterationService
    // Use "integration" as a pseudo-stage to track the failure
    iteration_service.create_iteration(&task.id, "integration", None)?;
    iteration_service.end_iteration(
        &task.id,
        "integration",
        Outcome::IntegrationFailed {
            error: error.to_string(),
            conflict_files: conflict_files.to_vec(),
        },
    )?;

    // Determine which stage to return to (flow-aware for subtasks)
    let recovery_stage = resolve_recovery_stage(workflow, task.flow.as_deref())
        .ok_or_else(|| WorkflowError::InvalidTransition("No recovery stage configured".into()))?;

    // Move task back to recovery stage
    let now = chrono::Utc::now().to_rfc3339();
    task.state = TaskState::queued(&recovery_stage);
    task.completed_at = None;
    task.updated_at = now;

    // Create new iteration in recovery stage with integration error context
    iteration_service.create_iteration(
        &task.id,
        &recovery_stage,
        Some(IterationTrigger::Integration {
            message: error.to_string(),
            conflict_files: conflict_files.to_vec(),
        }),
    )?;

    store.save_task(&task)?;
    Ok(task)
}

// -- Helpers --

fn resolve_recovery_stage(workflow: &WorkflowConfig, flow: Option<&str>) -> Option<String> {
    let configured = workflow.effective_integration_on_failure(flow);

    // Validate the configured stage exists in this task's flow
    if workflow.stage_in_flow(configured, flow) {
        return Some(configured.to_string());
    }

    // Fallback: use the first stage in the flow
    workflow.first_stage_in_flow(flow).map(|s| s.name.clone())
}
