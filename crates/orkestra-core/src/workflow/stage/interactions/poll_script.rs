//! Poll a single active script for completion.
//!
//! Checks the script handle, logs incremental output, and returns the result.

use crate::workflow::domain::LogEntry;
use crate::workflow::execution::ScriptPollState;
use crate::workflow::ports::WorkflowStore;
use crate::workflow::stage::scripts::{ActiveScript, ScriptCompletion, ScriptPollResult};

// ============================================================================
// Entry Point
// ============================================================================

/// Poll a single active script for completion.
///
/// Writes incremental output and exit entries to the database. Returns
/// `Completed` when the script exits, `Running` otherwise.
pub(crate) fn execute(store: &dyn WorkflowStore, script: &mut ActiveScript) -> ScriptPollResult {
    match script.handle.try_wait() {
        Ok(ScriptPollState::Completed(result)) => {
            // Write final output if any (may contain remaining buffered output)
            if !result.output.is_empty() {
                let _ = store.append_log_entry(
                    &script.stage_session_id,
                    &LogEntry::ScriptOutput {
                        content: result.output.clone(),
                    },
                );
            }

            let _ = store.append_log_entry(
                &script.stage_session_id,
                &LogEntry::ScriptExit {
                    code: result.exit_code,
                    success: result.is_success(),
                    timed_out: result.timed_out,
                },
            );

            ScriptPollResult::Completed(ScriptCompletion {
                task_id: script.task_id.clone(),
                stage: script.stage.clone(),
                result,
            })
        }
        Ok(ScriptPollState::Running { new_output }) => {
            // Write incremental output to database for real-time viewing
            if let Some(output) = new_output {
                if !output.is_empty() {
                    let _ = store.append_log_entry(
                        &script.stage_session_id,
                        &LogEntry::ScriptOutput { content: output },
                    );
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
