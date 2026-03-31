//! Try to detect structured output in chat text and complete the stage.

use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::agent::interactions::process_output::dispatch_output;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::IterationTrigger;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use orkestra_parser::interactions::output::{
    extract_fenced_json, parse_stage_output, strip_markdown_fences,
};

/// Try to detect structured stage output in accumulated chat text and complete the stage.
///
/// Returns `Ok(true)` if valid stage output was detected and the stage was completed.
/// Returns `Ok(false)` if no valid output was detected (caller continues normal flow).
/// Returns `Err` only for unexpected infrastructure failures — schema parse errors
/// and JSON detection failures are treated as `Ok(false)`.
pub fn execute(
    store: &Arc<dyn WorkflowStore>,
    workflow: &WorkflowConfig,
    schema: &serde_json::Value,
    task_id: &str,
    stage: &str,
    accumulated_text: &str,
) -> WorkflowResult<bool> {
    // Try to extract JSON from the accumulated text (first match wins)
    let json_str = extract_json(accumulated_text);
    let Some(json_str) = json_str else {
        return Ok(false);
    };

    // Validate extracted JSON against the stage schema
    let output = match parse_stage_output::execute(&json_str, schema) {
        Ok(output) => output,
        Err(e) => {
            orkestra_debug!(
                "stage_chat",
                "JSON found but failed schema validation for task {task_id}: {e}"
            );
            return Ok(false);
        }
    };

    // Re-load task and check can_chat() — human may have acted in the meantime
    let Some(mut task) = store.get_task(task_id)? else {
        return Ok(false);
    };

    if !task.can_chat() {
        orkestra_debug!(
            "stage_chat",
            "Structured output detected for task {task_id} but task is no longer in chat state ({}), skipping",
            task.state
        );
        return Ok(false);
    }

    // Create a new iteration with ChatCompletion trigger FIRST,
    // so that set_activity_log writes to this iteration (not the previous one).
    let iteration_service = IterationService::new(Arc::clone(store));
    iteration_service.create_iteration(task_id, stage, Some(IterationTrigger::ChatCompletion))?;

    // Persist activity log if present (now writes to the ChatCompletion iteration)
    if let Some(log) = output.activity_log() {
        iteration_service.set_activity_log(task_id, stage, log)?;
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Dispatch the output through the shared handler (same as normal agent completion)
    dispatch_output(workflow, &iteration_service, &mut task, output, stage, &now)?;

    // Save updated task
    store.save_task(&task)?;

    // Exit chat mode on the session
    if let Some(mut session) = store.get_stage_session(task_id, stage)? {
        session.exit_chat(&now);
        store.save_stage_session(&session)?;
    }

    Ok(true)
}

// -- Helpers --

/// Try to extract a JSON string from accumulated text using multiple strategies.
///
/// Returns the first valid JSON string found, or `None` if none was found.
fn extract_json(text: &str) -> Option<String> {
    let trimmed = text.trim();

    // Strategy 1: raw JSON
    if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
        return Some(trimmed.to_string());
    }

    // Strategy 2: strip markdown fences then parse
    let stripped = strip_markdown_fences::execute(trimmed);
    if stripped != trimmed && serde_json::from_str::<serde_json::Value>(&stripped).is_ok() {
        return Some(stripped);
    }

    // Strategy 3: extract fenced JSON from mixed prose + fence
    if let Some((_prose, json_str)) = extract_fenced_json::execute(trimmed) {
        return Some(json_str);
    }

    None
}
