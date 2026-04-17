//! Poll a single active script for completion.
//!
//! Checks the script handle, accumulates gate output, and returns the result.

use chrono::Utc;

use crate::workflow::execution::{ScriptPollState, ScriptResult};
use crate::workflow::ports::WorkflowStore;
use crate::workflow::stage::scripts::{ActiveScript, ScriptCompletion, ScriptPollResult};
use orkestra_types::domain::{GateResult, LogEntry};

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
            let iteration_id = script.iteration_id.clone();
            if let Some(ref iteration_id) = iteration_id {
                on_gate_completed(store, script, &result, iteration_id);
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
                    script.lines.push(output.clone());
                    if let Some(iteration_id) = script.iteration_id.as_deref() {
                        on_gate_output(store, script, output, iteration_id);
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

// ============================================================================
// Helpers
// ============================================================================

/// Persist the final gate result and emit `GateOutput` + `GateCompleted` log entries.
fn on_gate_completed(
    store: &dyn WorkflowStore,
    script: &mut ActiveScript,
    result: &ScriptResult,
    iteration_id: &str,
) {
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
        crate::orkestra_debug!("stage", "Failed to touch task {}: {}", script.task_id, e);
    }
    if let Some(session_id) = script.stage_session_id.as_deref() {
        append_gate_log_entries(store, session_id, iteration_id, result);
    }
}

/// Persist incremental gate output and emit a `GateOutput` log entry.
fn on_gate_output(
    store: &dyn WorkflowStore,
    script: &ActiveScript,
    output: String,
    iteration_id: &str,
) {
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
        crate::orkestra_debug!("stage", "Failed to touch task {}: {}", script.task_id, e);
    }
    if let Some(session_id) = script.stage_session_id.as_deref() {
        let entry = LogEntry::GateOutput { content: output };
        if let Err(e) = store.append_log_entry(session_id, &entry, Some(iteration_id)) {
            crate::orkestra_debug!(
                "stage",
                "Failed to append GateOutput for {}: {}",
                session_id,
                e
            );
        }
    }
}

/// Emit `GateOutput` (if any) and `GateCompleted` log entries for a finished gate run.
fn append_gate_log_entries(
    store: &dyn WorkflowStore,
    session_id: &str,
    iteration_id: &str,
    result: &ScriptResult,
) {
    if !result.output.is_empty() {
        let entry = LogEntry::GateOutput {
            content: result.output.clone(),
        };
        if let Err(e) = store.append_log_entry(session_id, &entry, Some(iteration_id)) {
            crate::orkestra_debug!(
                "stage",
                "Failed to append GateOutput for {}: {}",
                session_id,
                e
            );
        }
    }
    let entry = LogEntry::GateCompleted {
        exit_code: result.exit_code,
        passed: result.is_success(),
    };
    if let Err(e) = store.append_log_entry(session_id, &entry, Some(iteration_id)) {
        crate::orkestra_debug!(
            "stage",
            "Failed to append GateCompleted for {}: {}",
            session_id,
            e
        );
    }
}
