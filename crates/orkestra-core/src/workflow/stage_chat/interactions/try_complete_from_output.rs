//! Try to detect structured output in chat text and complete the stage.

use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::agent::interactions::process_output::dispatch_output;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::IterationTrigger;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use orkestra_parser::interactions::output::{
    extract_fenced_json, extract_ork_fence, parse_stage_output, strip_markdown_fences,
};

/// Result of structured output detection in chat text.
pub enum DetectionResult {
    /// Valid structured output detected and stage completed.
    Completed,
    /// No structured output detected in the text.
    NotDetected,
    /// JSON detected but schema validation failed. Contains the error message
    /// for corrective feedback to the agent.
    CorrectionNeeded(String),
}

/// Try to detect structured stage output in accumulated chat text and complete the stage.
///
/// Returns `Ok(DetectionResult::Completed)` if valid stage output was detected and the stage was completed.
/// Returns `Ok(DetectionResult::NotDetected)` if no valid output was detected (caller continues normal flow).
/// Returns `Ok(DetectionResult::CorrectionNeeded(msg))` if JSON was found but failed schema validation.
/// Returns `Err` only for unexpected infrastructure failures.
pub fn execute(
    store: &Arc<dyn WorkflowStore>,
    workflow: &WorkflowConfig,
    schema: &serde_json::Value,
    task_id: &str,
    stage: &str,
    accumulated_text: &str,
) -> WorkflowResult<DetectionResult> {
    // Try to extract JSON from the accumulated text (first match wins)
    let json_str = extract_json(accumulated_text);
    let Some(json_str) = json_str else {
        return Ok(DetectionResult::NotDetected);
    };

    // Validate extracted JSON against the stage schema
    let output = match parse_stage_output::execute(&json_str, schema) {
        Ok(output) => output,
        Err(e) => {
            let error_msg = format!(
                "Your output was detected as structured JSON but failed schema validation: {e}. \
                 Please output valid JSON matching the stage's output schema."
            );
            orkestra_debug!(
                "stage_chat",
                "JSON found but failed schema validation for task {task_id}: {e}"
            );
            return Ok(DetectionResult::CorrectionNeeded(error_msg));
        }
    };

    // Re-load task and check can_chat() — human may have acted in the meantime
    let Some(mut task) = store.get_task(task_id)? else {
        return Ok(DetectionResult::NotDetected);
    };

    if !task.can_chat() {
        orkestra_debug!(
            "stage_chat",
            "Structured output detected for task {task_id} but task is no longer in chat state ({}), skipping",
            task.state
        );
        return Ok(DetectionResult::NotDetected);
    }

    // Create a new iteration with ChatCompletion trigger FIRST,
    // so that set_activity_log writes to this iteration (not the previous one).
    let iteration_service = IterationService::new(Arc::clone(store));
    iteration_service.create_iteration(task_id, stage, Some(IterationTrigger::ChatCompletion))?;

    // Capture the active iteration ID for artifact tagging and log entry association.
    let iteration_id = store
        .get_active_iteration(task_id, stage)?
        .ok_or_else(|| {
            crate::workflow::ports::WorkflowError::InvalidState(format!(
                "no active iteration for task {task_id} in stage {stage}"
            ))
        })?
        .id;

    // Persist activity log if present (now writes to the ChatCompletion iteration)
    if let Some(log) = output.activity_log() {
        iteration_service.set_activity_log(task_id, stage, log)?;
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Dispatch the output through the shared handler (same as normal agent completion)
    dispatch_output(
        store.as_ref(),
        workflow,
        &iteration_service,
        &mut task,
        output,
        stage,
        &now,
        &iteration_id,
    )?;

    // Save updated task
    store.save_task(&task)?;

    // Exit chat mode on the session
    if let Some(mut session) = store.get_stage_session(task_id, stage)? {
        session.exit_chat(&now);
        store.save_stage_session(&session)?;
    }

    Ok(DetectionResult::Completed)
}

// -- Helpers --

/// Try to extract a JSON string from accumulated text using multiple strategies.
///
/// Returns the first valid JSON string found, or `None` if none was found.
fn extract_json(text: &str) -> Option<String> {
    let trimmed = text.trim();

    // Strategy 1: ork fence (highest priority — explicit structured output marker)
    if let Some(json_str) = extract_ork_fence::execute(trimmed) {
        return Some(json_str);
    }

    // Strategy 2: raw JSON with orkestra-like structure (has "type" string field)
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if value.get("type").and_then(|t| t.as_str()).is_some() {
            return Some(trimmed.to_string());
        }
    }

    // Strategy 3: strip markdown fences then parse
    let stripped = strip_markdown_fences::execute(trimmed);
    if stripped != trimmed {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&stripped) {
            if value.get("type").and_then(|t| t.as_str()).is_some() {
                return Some(stripped);
            }
        }
    }

    // Strategy 4: extract fenced JSON from mixed prose + fence
    if let Some((_prose, json_str)) = extract_fenced_json::execute(trimmed) {
        return Some(json_str);
    }

    None
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::{StageConfig, WorkflowConfig};
    use crate::workflow::domain::Task;
    use crate::workflow::ports::WorkflowStore;
    use crate::workflow::runtime::TaskState;
    use serde_json::json;

    /// A minimal schema that accepts "summary", "failed", and "blocked" types.
    fn test_schema() -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["summary", "failed", "blocked"]
                },
                "content": { "type": "string" },
                "error": { "type": "string" }
            },
            "required": ["type"]
        })
    }

    /// A workflow with a single "work" stage.
    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
    }

    /// Create a store with a task in AwaitingApproval("work") state.
    fn store_with_awaiting_task(task_id: &str) -> Arc<dyn WorkflowStore> {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let mut task = Task::new(
            task_id,
            "Test Task",
            "Description",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();
        store
    }

    #[test]
    fn ork_fence_wins_over_generic_fence() {
        let task_id = "test-ork-fence";
        let store = store_with_awaiting_task(task_id);
        let workflow = test_workflow();
        let schema = test_schema();

        // Text with both a ```json fence and an ```ork fence — ork wins
        let text = "Here is some prose.\n\n\
            ```json\n{\"type\":\"summary\",\"content\":\"from-json-fence\"}\n```\n\n\
            Final answer:\n\n\
            ```ork\n{\"type\":\"summary\",\"content\":\"from-ork-fence\"}\n```";

        let result = execute(&store, &workflow, &schema, task_id, "work", text).unwrap();
        assert!(
            matches!(result, DetectionResult::Completed),
            "ork fence should be detected and stage completed"
        );
    }

    #[test]
    fn orkestra_like_raw_json_detected() {
        let task_id = "test-raw-json";
        let store = store_with_awaiting_task(task_id);
        let workflow = test_workflow();
        let schema = test_schema();

        let text = r#"{"type":"summary","content":"done"}"#;

        let result = execute(&store, &workflow, &schema, task_id, "work", text).unwrap();
        assert!(
            matches!(result, DetectionResult::Completed),
            "raw JSON with type field should be detected and completed"
        );
    }

    #[test]
    fn non_orkestra_raw_json_returns_not_detected() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let workflow = test_workflow();
        let schema = test_schema();

        // JSON without a "type" field — not orkestra-like
        let text = r#"{"name":"foo","value":42}"#;

        let result = execute(&store, &workflow, &schema, "any-task", "work", text).unwrap();
        assert!(
            matches!(result, DetectionResult::NotDetected),
            "JSON without type field should return NotDetected"
        );
    }

    #[test]
    fn schema_validation_failure_returns_correction_needed() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let workflow = test_workflow();
        let schema = test_schema();

        // ork fence with a type value that is not in the schema's enum
        let text = "```ork\n{\"type\":\"bogus_type\",\"content\":\"something\"}\n```";

        let result = execute(&store, &workflow, &schema, "any-task", "work", text).unwrap();
        assert!(
            matches!(result, DetectionResult::CorrectionNeeded(_)),
            "ork fence with invalid type should return CorrectionNeeded"
        );
        if let DetectionResult::CorrectionNeeded(msg) = result {
            assert!(
                msg.contains("schema validation"),
                "error message should mention schema validation, got: {msg}"
            );
        }
    }

    #[test]
    fn plain_text_returns_not_detected() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let workflow = test_workflow();
        let schema = test_schema();

        let text = "This is just plain prose without any JSON or fences.";

        let result = execute(&store, &workflow, &schema, "any-task", "work", text).unwrap();
        assert!(
            matches!(result, DetectionResult::NotDetected),
            "plain text should return NotDetected"
        );
    }
}
