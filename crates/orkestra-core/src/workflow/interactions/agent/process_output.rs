//! Process completed agent output. Routes `StageOutput` variants to handlers.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::execution::StageOutput;
use crate::workflow::interactions::stage;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, Phase, Status};
use crate::workflow::services::IterationService;

#[allow(clippy::too_many_lines)]
pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    output: StageOutput,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::AgentWorking {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot process agent output in phase {:?} (expected AgentWorking)",
            task.phase
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    let output_type = output.type_label();

    orkestra_debug!(
        "action",
        "process_agent_output {}: type={}, stage={}",
        task_id,
        output_type,
        current_stage
    );

    let now = chrono::Utc::now().to_rfc3339();

    // Persist activity log before processing the output
    if let Some(log) = output.activity_log() {
        iteration_service.set_activity_log(task_id, &current_stage, log)?;
    }

    match output {
        StageOutput::Questions { questions } => {
            super::handle_questions::execute(
                workflow,
                iteration_service,
                &mut task,
                &questions,
                &current_stage,
                &now,
            )?;
        }
        StageOutput::Artifact { content, .. } => {
            super::handle_artifact::execute(
                workflow,
                iteration_service,
                &mut task,
                &content,
                &current_stage,
                &now,
            )?;
        }
        StageOutput::Approval {
            decision, content, ..
        } => {
            super::handle_approval::execute(
                store,
                workflow,
                iteration_service,
                &mut task,
                &current_stage,
                &decision,
                &content,
                &now,
            )?;
        }
        StageOutput::Subtasks {
            content,
            subtasks,
            skip_reason,
            ..
        } => {
            super::handle_subtasks::execute(
                workflow,
                iteration_service,
                &mut task,
                &content,
                &subtasks,
                skip_reason.as_deref(),
                &current_stage,
                &now,
            )?;
        }
        StageOutput::Failed { error } => {
            stage::end_iteration::execute(
                iteration_service,
                &task,
                Outcome::AgentError {
                    error: error.clone(),
                },
            )?;
            task.status = Status::failed(&error);
            task.phase = Phase::Idle;
            task.updated_at = now;
        }
        StageOutput::Blocked { reason } => {
            stage::end_iteration::execute(
                iteration_service,
                &task,
                Outcome::Blocked {
                    reason: reason.clone(),
                },
            )?;
            task.status = Status::blocked(&reason);
            task.phase = Phase::Idle;
            task.updated_at = now;
        }
    }

    orkestra_debug!(
        "action",
        "process_agent_output {} complete: phase={:?}, status={:?}",
        task_id,
        task.phase,
        task.status
    );

    store.save_task(&task)?;
    Ok(task)
}
