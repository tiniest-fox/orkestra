//! Agent output schemas and title generation prompt.
//!
//! This module provides:
//! - Dynamic JSON schema generation based on stage configuration
//! - Reusable schema components loaded from files
//! - Schema-validated example generators for prompts
//! - Title generator prompt template

pub mod examples;

use handlebars::Handlebars;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::LazyLock;

use crate::workflow::config::StageCapabilities;

// =============================================================================
// Schema Components (loaded from files)
// =============================================================================

/// Artifact schema component - generic artifact with content field.
const ARTIFACT_COMPONENT: &str = include_str!("schemas/components/artifact.json");

/// Questions schema component - for stages with ask_questions capability.
const QUESTIONS_COMPONENT: &str = include_str!("schemas/components/questions.json");

/// Subtasks schema component - for stages with produce_subtasks capability.
const SUBTASKS_COMPONENT: &str = include_str!("schemas/components/subtasks.json");

/// Restage schema component - for stages with supports_restage capability.
const RESTAGE_COMPONENT: &str = include_str!("schemas/components/restage.json");

/// Terminal states schema component - completed, failed, blocked.
const TERMINAL_COMPONENT: &str = include_str!("schemas/components/terminal.json");

// Note: The legacy schema files (breakdown.json, worker.json, reviewer.json, plan.json)
// are kept for reference but schemas are now generated dynamically via generate_stage_schema().
// The component files in schemas/components/ are the source of truth.

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
/// - The stage's artifact (type = artifact_name)
/// - Terminal states: failed, blocked
/// - Questions (if ask_questions capability)
/// - Subtasks (if produce_subtasks capability)
/// - Restage (if supports_restage capability)
pub fn generate_stage_schema(config: &SchemaConfig<'_>) -> String {
    let artifact = load_component(ARTIFACT_COMPONENT);
    let terminal = load_component(TERMINAL_COMPONENT);
    let questions = load_component(QUESTIONS_COMPONENT);
    let subtasks_component = load_component(SUBTASKS_COMPONENT);
    let restage = load_component(RESTAGE_COMPONENT);

    // Build the list of valid type values
    let mut type_enum = vec![
        config.artifact_name.to_string(),
        "failed".to_string(),
        "blocked".to_string(),
    ];

    if config.capabilities.ask_questions {
        type_enum.push("questions".to_string());
    }
    if config.capabilities.produce_subtasks {
        type_enum.push("subtasks".to_string());
    }
    if !config.capabilities.supports_restage.is_empty() {
        type_enum.push("restage".to_string());
    }

    // Build properties object
    let mut properties = json!({
        "type": {
            "type": "string",
            "enum": type_enum,
            "description": format!("Output type. Use '{}' for the main artifact.", config.artifact_name)
        }
    });

    // Add artifact content property
    if let Some(artifact_props) = artifact.get("properties") {
        if let Some(content) = artifact_props.get("content") {
            properties["content"] = content.clone();
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
    if config.capabilities.produce_subtasks {
        if let Some(s_props) = subtasks_component.get("properties") {
            if let Some(s) = s_props.get("subtasks") {
                properties["subtasks"] = s.clone();
            }
            if let Some(sr) = s_props.get("skip_reason") {
                properties["skip_reason"] = sr.clone();
            }
        }
    }

    // Add restage properties if capability enabled
    if !config.capabilities.supports_restage.is_empty() {
        if let Some(r_props) = restage.get("properties") {
            if let Some(target) = r_props.get("target") {
                properties["target"] = target.clone();
            }
            if let Some(feedback) = r_props.get("feedback") {
                properties["feedback"] = feedback.clone();
            }
        }
    }

    // Build the complete schema
    let schema = json!({
        "type": "object",
        "description": format!(
            "Stage output. Set 'type' to '{}' with 'content' for the artifact, or use terminal types (failed/blocked).",
            config.artifact_name
        ),
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

// =============================================================================
// Title Generator
// =============================================================================

const TITLE_GENERATOR_TEMPLATE: &str = include_str!("templates/title_generator.hbs");

static TEMPLATES: LazyLock<Handlebars<'static>> = LazyLock::new(|| {
    let mut hb = Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.register_template_string("title_generator", TITLE_GENERATOR_TEMPLATE)
        .expect("title_generator template");
    hb
});

#[derive(Serialize)]
struct TitleGeneratorContext<'a> {
    description: &'a str,
}

fn render_title_generator(ctx: &TitleGeneratorContext<'_>) -> String {
    TEMPLATES
        .render("title_generator", ctx)
        .expect("title_generator template should render")
}

/// Build a prompt for the title generator agent.
pub fn build_title_generator_prompt(description: &str) -> String {
    render_title_generator(&TitleGeneratorContext { description })
}

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
        let caps = StageCapabilities {
            produce_subtasks: true,
            ..Default::default()
        };
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

        // Type should be "subtasks" (not the legacy "breakdown")
        assert!(type_enum.iter().any(|v| v == "subtasks"));
        assert!(parsed.get("properties").unwrap().get("subtasks").is_some());
        // Should also have skip_reason property for skipping breakdown
        assert!(parsed.get("properties").unwrap().get("skip_reason").is_some());
    }

    #[test]
    fn test_generate_schema_with_restage() {
        let caps = StageCapabilities::with_restage(vec!["work".into()]);
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

        // Type should be "restage" (not the legacy "rejected")
        assert!(type_enum.iter().any(|v| v == "restage"));
        assert!(parsed.get("properties").unwrap().get("target").is_some());
        assert!(parsed.get("properties").unwrap().get("feedback").is_some());
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

    #[test]
    fn test_title_generator_prompt() {
        let prompt = build_title_generator_prompt("Fix the bug in login");
        assert!(prompt.contains("Fix the bug in login"));
    }
}
