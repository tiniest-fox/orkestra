//! Route a completed execution to the appropriate handler.

use crate::orkestra_debug;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::services::WorkflowApi;
use crate::workflow::services::{ExecutionComplete, ExecutionResult};
use crate::workflow::OrchestratorEvent;

/// Handle a completed execution (agent or script).
///
/// Dispatches based on result type to the appropriate `WorkflowApi` method.
pub fn execute(api: &WorkflowApi, exec: ExecutionComplete) -> WorkflowResult<OrchestratorEvent> {
    match exec.result {
        ExecutionResult::AgentSuccess(stage_output) => {
            let output_type = stage_output.type_label().to_string();
            orkestra_debug!(
                "orchestrator",
                "agent completed {}/{}: type={}, processing output",
                exec.task_id,
                exec.stage,
                output_type
            );
            match api.process_agent_output(&exec.task_id, stage_output) {
                Ok(_) => Ok(OrchestratorEvent::OutputProcessed {
                    task_id: exec.task_id,
                    stage: exec.stage,
                    output_type,
                }),
                Err(e) => {
                    orkestra_debug!(
                        "orchestrator",
                        "Failed to process agent output for {}: {}",
                        exec.task_id,
                        e
                    );
                    if let Err(fe) = api.fail_agent_execution(
                        &exec.task_id,
                        &format!("Output processing failed: {e}"),
                    ) {
                        orkestra_debug!(
                            "orchestrator",
                            "Failed to record output failure for {}: {}",
                            exec.task_id,
                            fe
                        );
                    }
                    Ok(OrchestratorEvent::Error {
                        task_id: Some(exec.task_id),
                        error: e.to_string(),
                    })
                }
            }
        }
        ExecutionResult::AgentFailed(error) | ExecutionResult::PollError { error } => {
            if let Err(e) =
                api.fail_agent_execution(&exec.task_id, &format!("Agent error: {error}"))
            {
                orkestra_debug!(
                    "orchestrator",
                    "Failed to record agent failure for {}: {}",
                    exec.task_id,
                    e
                );
            }
            Ok(OrchestratorEvent::Error {
                task_id: Some(exec.task_id),
                error,
            })
        }
        ExecutionResult::ScriptSuccess { output } => {
            match api.process_script_success(&exec.task_id, &output) {
                Ok(_) => Ok(OrchestratorEvent::ScriptCompleted {
                    task_id: exec.task_id,
                    stage: exec.stage,
                }),
                Err(e) => Ok(OrchestratorEvent::Error {
                    task_id: Some(exec.task_id),
                    error: e.to_string(),
                }),
            }
        }
        ExecutionResult::ScriptFailed { output, timed_out } => {
            let error_msg = if timed_out {
                format!("Script timed out:\n{output}")
            } else {
                format!("Script failed:\n{output}")
            };

            match api.process_script_failure(
                &exec.task_id,
                &error_msg,
                exec.recovery_stage.as_deref(),
            ) {
                Ok(_) => Ok(OrchestratorEvent::ScriptFailed {
                    task_id: exec.task_id,
                    stage: exec.stage,
                    error: error_msg,
                    recovery_stage: exec.recovery_stage,
                }),
                Err(e) => Ok(OrchestratorEvent::Error {
                    task_id: Some(exec.task_id),
                    error: e.to_string(),
                }),
            }
        }
    }
}
