//! Handle script failure. Transitions to recovery stage if configured.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::interactions::stage;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Artifact, Outcome, Phase, Status};
use crate::workflow::services::IterationService;

use super::process_script_success::strip_ansi_codes;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    error: &str,
    recovery_stage: Option<&str>,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::AgentWorking {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot process script failure in phase {:?}",
            task.phase
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    orkestra_debug!(
        "action",
        "process_script_failure {}: stage={}, recovery={:?}",
        task_id,
        current_stage,
        recovery_stage
    );

    let now = chrono::Utc::now().to_rfc3339();

    // Strip ANSI codes from error message for clean LLM consumption
    let clean_error = strip_ansi_codes(error);

    // Store error as artifact (mirrors process_script_success pattern)
    let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
        workflow,
        &current_stage,
        "script_output",
    );
    task.artifacts.set(Artifact::new(
        &artifact_name,
        &clean_error,
        &current_stage,
        &now,
    ));

    // End current iteration with script failure outcome
    stage::end_iteration::execute(
        iteration_service,
        &task,
        Outcome::script_failed(
            &current_stage,
            &clean_error,
            recovery_stage.map(String::from),
        ),
    )?;

    if let Some(target) = recovery_stage {
        // Transition to recovery stage
        task.status = Status::active(target);
        task.phase = Phase::Idle;

        // Create new iteration in recovery stage with script failure trigger
        iteration_service.create_iteration(
            &task.id,
            target,
            Some(IterationTrigger::ScriptFailure {
                from_stage: current_stage,
                error: clean_error,
            }),
        )?;
    } else {
        // No recovery stage - mark task as failed
        task.status = Status::failed(&clean_error);
        task.phase = Phase::Idle;
    }

    task.updated_at = now;

    orkestra_debug!(
        "action",
        "process_script_failure {} complete: phase={:?}, status={:?}",
        task_id,
        task.phase,
        task.status
    );

    store.save_task(&task)?;
    Ok(task)
}
