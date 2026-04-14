//! Poll a single active script for completion.
//!
//! Checks the script handle, accumulates gate output, and returns the result.

use chrono::Utc;

use crate::workflow::execution::ScriptPollState;
use crate::workflow::ports::WorkflowStore;
use crate::workflow::stage::scripts::{ActiveScript, ScriptCompletion, ScriptPollResult};
use orkestra_types::domain::GateResult;

// ============================================================================
// Entry Point
// ============================================================================

/// Poll a single active script for completion.
///
/// Accumulates output into `lines` and writes `GateResult` to the iteration via
/// `save_gate_result` on each tick. Returns `Completed` when the script exits,
/// `Running` otherwise.
pub(crate) fn execute(store: &dyn WorkflowStore, script: &mut ActiveScript) -> ScriptPollResult {
    match script.handle.try_wait() {
        Ok(ScriptPollState::Completed(result)) => {
            if let Some(iteration_id) = script.iteration_id.as_deref() {
                // Push remaining output, write final GateResult
                if !result.output.is_empty() {
                    script.lines.push(result.output.clone());
                }
                let gate_result = GateResult {
                    lines: script.lines.clone(),
                    exit_code: Some(result.exit_code),
                    started_at: script.started_at.clone(),
                    ended_at: Some(Utc::now().to_rfc3339()),
                };
                if let Err(e) = store.save_gate_result(iteration_id, &gate_result) {
                    crate::orkestra_debug!(
                        "stage",
                        "Failed to save gate result for {}: {}",
                        iteration_id,
                        e
                    );
                }
                if let Err(e) = store.touch_task(&script.task_id) {
                    crate::orkestra_debug!(
                        "stage",
                        "Failed to touch task {} after gate result: {}",
                        script.task_id,
                        e
                    );
                }
            }

            ScriptPollResult::Completed(ScriptCompletion {
                task_id: script.task_id.clone(),
                stage: script.stage.clone(),
                result,
            })
        }
        Ok(ScriptPollState::Running { new_output }) => {
            if let Some(output) = new_output {
                if !output.is_empty() {
                    script.lines.push(output);
                    if let Some(iteration_id) = script.iteration_id.as_deref() {
                        let gate_result = GateResult {
                            lines: script.lines.clone(),
                            exit_code: None,
                            started_at: script.started_at.clone(),
                            ended_at: None,
                        };
                        if let Err(e) = store.save_gate_result(iteration_id, &gate_result) {
                            crate::orkestra_debug!(
                                "stage",
                                "Failed to save gate result for {}: {}",
                                iteration_id,
                                e
                            );
                        }
                        if let Err(e) = store.touch_task(&script.task_id) {
                            crate::orkestra_debug!(
                                "stage",
                                "Failed to touch task {} after gate result: {}",
                                script.task_id,
                                e
                            );
                        }
                    }
                }
            }
            ScriptPollResult::Running
        }
        Err(e) => ScriptPollResult::Error {
            task_id: script.task_id.clone(),
            stage: script.stage.clone(),
            message: format!("Failed to poll gate script: {e}"),
        },
    }
}
