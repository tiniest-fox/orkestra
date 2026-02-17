//! Handle successful script completion.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Artifact, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    output: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::AgentWorking { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot process script output in state {} (expected AgentWorking)",
            task.state
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    orkestra_debug!(
        "action",
        "process_script_success {}: stage={}",
        task_id,
        current_stage
    );

    let now = chrono::Utc::now().to_rfc3339();

    // Create artifact from script output, stripping ANSI codes for clean LLM consumption
    let clean_output = strip_ansi_codes(output);
    let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
        workflow,
        &current_stage,
        "script_output",
    );
    task.artifacts.set(Artifact::new(
        &artifact_name,
        &clean_output,
        &current_stage,
        &now,
    ));

    // Script stages always auto-approve — enter commit pipeline before advancing.
    stage::enter_commit_pipeline::execute(iteration_service, &mut task, &now)?;

    orkestra_debug!(
        "action",
        "process_script_success {} complete: state={}",
        task_id,
        task.state
    );

    store.save_task(&task)?;
    Ok(task)
}

// -- Helpers --

/// Strip ANSI escape codes from a string.
pub(super) fn strip_ansi_codes(input: &str) -> String {
    let bytes = strip_ansi_escapes::strip(input);
    String::from_utf8_lossy(&bytes).into_owned()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi_codes_removes_colors() {
        let input = "\x1b[31mred text\x1b[0m normal text \x1b[32mgreen\x1b[0m";
        let result = strip_ansi_codes(input);
        assert_eq!(result, "red text normal text green");
        assert!(!result.contains("\x1b["));
    }

    #[test]
    fn test_strip_ansi_codes_preserves_plain_text() {
        let input = "plain text without any escapes\nwith newlines";
        let result = strip_ansi_codes(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_strip_ansi_codes_handles_empty_string() {
        let result = strip_ansi_codes("");
        assert_eq!(result, "");
    }

    #[test]
    fn test_strip_ansi_codes_handles_complex_sequences() {
        let input =
            "\x1b[1mbold\x1b[0m \x1b[4munderline\x1b[0m \x1b[38;5;196mextended color\x1b[0m";
        let result = strip_ansi_codes(input);
        assert_eq!(result, "bold underline extended color");
    }
}
