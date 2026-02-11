//! Agent output schemas.
//!
//! This module provides:
//! - Dynamic JSON schema generation based on stage configuration
//! - Reusable schema components loaded from files
//! - Schema-validated example generators for prompts

pub mod examples;

use serde_json::{json, Value};
use std::sync::LazyLock;

use crate::workflow::config::StageCapabilities;

// =============================================================================
// Schema Components (loaded from files)
// =============================================================================

/// Artifact schema component - generic artifact with content field.
const ARTIFACT_COMPONENT: &str = include_str!("schemas/components/artifact.json");

/// Questions schema component - for stages with `ask_questions` capability.
const QUESTIONS_COMPONENT: &str = include_str!("schemas/components/questions.json");

/// Subtasks schema component - for stages with subtask capabilities.
const SUBTASKS_COMPONENT: &str = include_str!("schemas/components/subtasks.json");

/// Approval schema component - for stages with `approval` capability.
const APPROVAL_COMPONENT: &str = include_str!("schemas/components/approval.json");

/// Terminal states schema component - failed, blocked.
const TERMINAL_COMPONENT: &str = include_str!("schemas/components/terminal.json");

// =============================================================================
// Assistant Prompt Templates
// =============================================================================

/// System prompt for the assistant chat panel.
pub const ASSISTANT_SYSTEM_PROMPT: &str = include_str!("templates/assistant/system_prompt.md");

// =============================================================================
// Dynamic Schema Generation
// =============================================================================

/// Configuration for schema generation.
#[derive(Debug, Clone)]
pub struct SchemaConfig<'a> {
    /// Name of the artifact this stage produces.
    pub artifact_name: &'a str,
    /// Stage capabilities.
    pub capabilities: &'a StageCapabilities,
}

/// Generate a JSON schema for a stage based on its configuration.
///
/// The schema is a flat discriminated union (no oneOf at top level)
/// that includes all valid output types for the stage:
/// - The stage's artifact (type = `artifact_name`)
/// - Terminal states: failed, blocked
/// - Questions (if `ask_questions` capability)
/// - Subtasks (if subtask capabilities present)
/// - Approval (if `approval` capability — replaces normal artifact type)
///
/// # Panics
///
/// Panics if the schema cannot be serialized to JSON (should never happen).
#[allow(clippy::too_many_lines)]
pub fn generate_stage_schema(config: &SchemaConfig<'_>) -> String {
    let artifact = load_component(ARTIFACT_COMPONENT);
    let terminal = load_component(TERMINAL_COMPONENT);
    let questions = load_component(QUESTIONS_COMPONENT);
    let subtasks_component = load_component(SUBTASKS_COMPONENT);
    let approval = load_component(APPROVAL_COMPONENT);

    // Build the list of valid type values.
    // For subtask stages, the artifact is embedded in the subtasks output,
    // so the artifact type name is excluded from the enum.
    // For approval stages, the artifact is embedded in the approval output,
    // so the artifact type name is also excluded.
    let mut type_enum = vec!["failed".to_string(), "blocked".to_string()];

    if !config.capabilities.produces_subtasks() && !config.capabilities.has_approval() {
        type_enum.insert(0, config.artifact_name.to_string());
    }
    if config.capabilities.ask_questions {
        type_enum.push("questions".to_string());
    }
    if config.capabilities.produces_subtasks() {
        type_enum.push("subtasks".to_string());
    }
    if config.capabilities.has_approval() {
        type_enum.insert(0, "approval".to_string());
    }

    // Build properties object
    let mut properties = json!({
        "type": {
            "type": "string",
            "enum": type_enum,
            "description": format!("Output type. Use '{}' for the main artifact.", config.artifact_name)
        }
    });

    // Add artifact content property (only for non-subtask stages).
    // For subtask stages, content comes from the subtasks component instead.
    if !config.capabilities.produces_subtasks() {
        if let Some(artifact_props) = artifact.get("properties") {
            if let Some(content) = artifact_props.get("content") {
                properties["content"] = content.clone();
            }
        }
    }

    // Add activity_log property for non-subtask, non-approval stages
    if !config.capabilities.produces_subtasks() && !config.capabilities.has_approval() {
        if let Some(artifact_props) = artifact.get("properties") {
            if let Some(activity_log) = artifact_props.get("activity_log") {
                properties["activity_log"] = activity_log.clone();
            }
        }
    }

    // Add terminal state properties
    if let Some(failed) = terminal.get("failed").and_then(|f| f.get("properties")) {
        if let Some(error) = failed.get("error") {
            properties["error"] = error.clone();
        }
    }
    if let Some(blocked) = terminal.get("blocked").and_then(|b| b.get("properties")) {
        if let Some(reason) = blocked.get("reason") {
            properties["reason"] = reason.clone();
        }
    }

    // Add questions property if capability enabled
    if config.capabilities.ask_questions {
        if let Some(q_props) = questions.get("properties") {
            if let Some(q) = q_props.get("questions") {
                properties["questions"] = q.clone();
            }
        }
    }

    // Add subtasks properties if capability enabled
    if config.capabilities.produces_subtasks() {
        if let Some(s_props) = subtasks_component.get("properties") {
            if let Some(c) = s_props.get("content") {
                properties["content"] = c.clone();
            }
            if let Some(s) = s_props.get("subtasks") {
                properties["subtasks"] = s.clone();
            }
            if let Some(sr) = s_props.get("skip_reason") {
                properties["skip_reason"] = sr.clone();
            }
            if let Some(al) = s_props.get("activity_log") {
                properties["activity_log"] = al.clone();
            }
        }
    }

    // Add approval properties if capability enabled
    if config.capabilities.has_approval() {
        if let Some(a_props) = approval.get("properties") {
            if let Some(decision) = a_props.get("decision") {
                properties["decision"] = decision.clone();
            }
            if let Some(content) = a_props.get("content") {
                properties["content"] = content.clone();
            }
            if let Some(al) = a_props.get("activity_log") {
                properties["activity_log"] = al.clone();
            }
        }
    }

    // Build the complete schema
    let description = if config.capabilities.produces_subtasks() {
        "Stage output. Use 'subtasks' with 'content' for the artifact and structured subtask data, or use terminal types (failed/blocked).".to_string()
    } else {
        format!(
            "Stage output. Set 'type' to '{}' with 'content' for the artifact, or use terminal types (failed/blocked).",
            config.artifact_name
        )
    };

    let schema = json!({
        "type": "object",
        "description": description,
        "properties": properties,
        "required": ["type"],
        "additionalProperties": false
    });

    serde_json::to_string(&schema).expect("schema should serialize")
}

/// Load and parse a component schema.
fn load_component(json_str: &str) -> Value {
    serde_json::from_str(json_str).expect("component schema should be valid JSON")
}

// =============================================================================
// Legacy Schema Support (for backwards compatibility)
// =============================================================================

/// Composed planner schema - kept for backwards compatibility.
/// New code should use `generate_stage_schema` instead.
pub static PLANNER_OUTPUT_SCHEMA: LazyLock<String> = LazyLock::new(|| {
    // Use the new generator with planning stage defaults
    generate_stage_schema(&SchemaConfig {
        artifact_name: "plan",
        capabilities: &StageCapabilities::with_questions(),
    })
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_schema_basic() {
        let config = SchemaConfig {
            artifact_name: "plan",
            capabilities: &StageCapabilities::default(),
        };
        let schema = generate_stage_schema(&config);
        let parsed: Value = serde_json::from_str(&schema).unwrap();

        // Should have type property with enum
        let type_prop = parsed.get("properties").unwrap().get("type").unwrap();
        let type_enum = type_prop.get("enum").unwrap().as_array().unwrap();
        assert!(type_enum.iter().any(|v| v == "plan"));
        assert!(type_enum.iter().any(|v| v == "failed"));
        assert!(type_enum.iter().any(|v| v == "blocked"));

        // Should NOT have questions or completed (no capability, completed removed)
        assert!(!type_enum.iter().any(|v| v == "questions"));
        assert!(!type_enum.iter().any(|v| v == "completed"));
    }

    #[test]
    fn test_generate_schema_with_questions() {
        let config = SchemaConfig {
            artifact_name: "plan",
            capabilities: &StageCapabilities::with_questions(),
        };
        let schema = generate_stage_schema(&config);
        let parsed: Value = serde_json::from_str(&schema).unwrap();

        let type_enum = parsed
            .get("properties")
            .unwrap()
            .get("type")
            .unwrap()
            .get("enum")
            .unwrap()
            .as_array()
            .unwrap();

        // Should have questions
        assert!(type_enum.iter().any(|v| v == "questions"));

        // Should have questions property
        assert!(parsed.get("properties").unwrap().get("questions").is_some());
    }

    #[test]
    fn test_generate_schema_with_subtasks() {
        let caps = StageCapabilities::with_subtasks();
        let config = SchemaConfig {
            artifact_name: "breakdown",
            capabilities: &caps,
        };
        let schema = generate_stage_schema(&config);
        let parsed: Value = serde_json::from_str(&schema).unwrap();

        let type_enum = parsed
            .get("properties")
            .unwrap()
            .get("type")
            .unwrap()
            .get("enum")
            .unwrap()
            .as_array()
            .unwrap();

        // Artifact name should NOT be in type enum (subtasks wraps the artifact)
        assert!(!type_enum.iter().any(|v| v == "breakdown"));
        // "subtasks" should be in the enum
        assert!(type_enum.iter().any(|v| v == "subtasks"));
        // Should have subtasks, skip_reason, and content properties
        let props = parsed.get("properties").unwrap();
        assert!(props.get("subtasks").is_some());
        assert!(props.get("skip_reason").is_some());
        assert!(props.get("content").is_some());
    }

    #[test]
    fn test_generate_schema_with_approval() {
        let caps = StageCapabilities::with_approval(Some("work".into()));
        let config = SchemaConfig {
            artifact_name: "verdict",
            capabilities: &caps,
        };
        let schema = generate_stage_schema(&config);
        let parsed: Value = serde_json::from_str(&schema).unwrap();

        let type_enum = parsed
            .get("properties")
            .unwrap()
            .get("type")
            .unwrap()
            .get("enum")
            .unwrap()
            .as_array()
            .unwrap();

        // Type should be "approval" (not the artifact name)
        assert!(type_enum.iter().any(|v| v == "approval"));
        // Artifact name should NOT be in type enum (approval wraps content)
        assert!(!type_enum.iter().any(|v| v == "verdict"));
        assert!(parsed.get("properties").unwrap().get("decision").is_some());
        assert!(parsed.get("properties").unwrap().get("content").is_some());
    }

    #[test]
    fn test_planner_schema_no_oneof() {
        let schema = PLANNER_OUTPUT_SCHEMA.as_str();
        let parsed: Value = serde_json::from_str(schema).unwrap();

        // Should NOT have oneOf at top level
        assert!(parsed.get("oneOf").is_none());

        // Should have flat properties with type discriminator
        assert!(parsed.get("properties").is_some());
        assert!(parsed.get("properties").unwrap().get("type").is_some());
    }
}
