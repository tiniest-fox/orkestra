//! Route a completed execution to the appropriate handler.

use crate::orkestra_debug;
use crate::workflow::api::WorkflowApi;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::stage::service::{ExecutionComplete, ExecutionResult};
use crate::workflow::OrchestratorEvent;

// ============================================================================
// Helpers
// ============================================================================

/// Persist the activity flag for a stage session when the agent produced output.
///
/// Called on `AgentSuccess` (valid structured output) and `AgentMalformedOutput`
/// (agent produced output but it wasn't parseable). Setting `has_activity=true`
/// allows the next spawn to resume the existing session (`is_resume=true`) rather
/// than starting a fresh one. Not called on crashes or poll errors — those indicate
/// the agent produced nothing useful and resuming would perpetuate a broken session.
fn persist_activity_flag(
    store: &dyn WorkflowStore,
    task_id: &str,
    stage: &str,
) -> WorkflowResult<()> {
    if let Some(mut session) = store.get_stage_session(task_id, stage)? {
        session.has_activity = true;
        store.save_stage_session(&session)?;
    }
    Ok(())
}

// ============================================================================
// Dispatch
// ============================================================================

/// Handle a completed execution (agent or script).
///
/// Dispatches based on result type to the appropriate `WorkflowApi` method.
#[allow(clippy::too_many_lines)]
pub fn execute(api: &WorkflowApi, exec: ExecutionComplete) -> WorkflowResult<OrchestratorEvent> {
    match exec.result {
        ExecutionResult::AgentSuccess(stage_output) => {
            let output_type = stage_output.notification_label().to_string();
            orkestra_debug!(
                "orchestrator",
                "agent completed {}/{}: type={}, processing output",
                exec.task_id,
                exec.stage,
                output_type
            );
            match api.process_agent_output(&exec.task_id, stage_output) {
                Ok(_) => {
                    // Persist activity flag on successful completion.
                    // Non-fatal: if this fails, the next spawn will start fresh instead of
                    // resuming. This is acceptable because (1) the agent output was already
                    // successfully processed, and (2) starting fresh is safe — no work is lost.
                    if let Err(e) =
                        persist_activity_flag(api.store.as_ref(), &exec.task_id, &exec.stage)
                    {
                        orkestra_debug!(
                            "orchestrator",
                            "Failed to persist activity flag for {}/{}: {}",
                            exec.task_id,
                            exec.stage,
                            e
                        );
                    }
                    Ok(OrchestratorEvent::OutputProcessed {
                        task_id: exec.task_id,
                        stage: exec.stage,
                        output_type,
                    })
                }
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
        ExecutionResult::AgentMalformedOutput(error) => {
            // Persist activity flag so the retry spawn resumes the existing session.
            // The agent produced output (just not valid structured output), so the
            // session should continue with a corrective prompt rather than start fresh.
            // Without this, session.has_activity stays false → is_resume=false → fresh
            // initial prompt is sent instead of the corrective malformed_output template.
            if let Err(e) = persist_activity_flag(api.store.as_ref(), &exec.task_id, &exec.stage) {
                orkestra_debug!(
                    "orchestrator",
                    "Failed to persist activity flag for malformed output {}/{}: {}",
                    exec.task_id,
                    exec.stage,
                    e
                );
            }
            match api.auto_retry_malformed_output(&exec.task_id, &error) {
                Ok(_) => Ok(OrchestratorEvent::OutputProcessed {
                    task_id: exec.task_id,
                    stage: exec.stage,
                    output_type: "malformed_retry".to_string(),
                }),
                Err(e) => {
                    // Fallback: if retry write fails, fail the task to avoid a stuck state.
                    if let Err(fe) = api.fail_agent_execution(
                        &exec.task_id,
                        &format!("Malformed output retry failed: {e}"),
                    ) {
                        orkestra_debug!(
                            "orchestrator",
                            "Failed to record retry failure for {}: {}",
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
        ExecutionResult::GateSuccess => match api.process_gate_success(&exec.task_id) {
            Ok(_) => Ok(OrchestratorEvent::GatePassed {
                task_id: exec.task_id,
                stage: exec.stage,
            }),
            Err(e) => Ok(OrchestratorEvent::Error {
                task_id: Some(exec.task_id),
                error: e.to_string(),
            }),
        },
        ExecutionResult::GateFailed { output, timed_out } => {
            let error_msg = if timed_out {
                format!("Gate timed out:\n{output}")
            } else {
                format!("Gate failed:\n{output}")
            };
            match api.process_gate_failure(&exec.task_id, &error_msg) {
                Ok(_) => Ok(OrchestratorEvent::GateFailed {
                    task_id: exec.task_id,
                    stage: exec.stage,
                    error: error_msg,
                }),
                Err(e) => Ok(OrchestratorEvent::Error {
                    task_id: Some(exec.task_id),
                    error: e.to_string(),
                }),
            }
        }
    }
}
