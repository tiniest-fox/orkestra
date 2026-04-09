//! Core schema generation logic.

use serde_json::{json, Value};

use crate::types::SchemaConfig;

// ============================================================================
// Schema Components (loaded from files)
// ============================================================================

/// Artifact schema component - generic artifact with content field.
const ARTIFACT_COMPONENT: &str = include_str!("schemas/components/artifact.json");

/// Questions schema component - included in all stage schemas.
const QUESTIONS_COMPONENT: &str = include_str!("schemas/components/questions.json");

/// Subtasks schema component - for stages with subtask capabilities.
const SUBTASKS_COMPONENT: &str = include_str!("schemas/components/subtasks.json");

/// Approval schema component - for stages with `approval` capability.
const APPROVAL_COMPONENT: &str = include_str!("schemas/components/approval.json");

/// Terminal states schema component - failed, blocked.
const TERMINAL_COMPONENT: &str = include_str!("schemas/components/terminal.json");

/// Resources schema component - cross-stage external references.
const RESOURCES_COMPONENT: &str = include_str!("schemas/components/resources.json");

// ============================================================================
// Schema Generation
// ============================================================================

/// Generate a JSON schema for a stage based on its configuration.
///
/// The schema is a flat discriminated union (no oneOf at top level)
/// that includes all valid output types for the stage:
/// - The stage's artifact (type = `artifact_name`)
/// - Terminal states: failed, blocked
/// - Questions (always included — any agent can ask for clarification)
/// - Subtasks (if `produces_subtasks`)
/// - Approval (if `has_approval` — replaces normal artifact type)
///
/// # Panics
///
/// Panics if the schema cannot be serialized to JSON (should never happen).
#[allow(clippy::too_many_lines)]
pub fn execute(config: &SchemaConfig<'_>) -> String {
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

    if !config.produces_subtasks && !config.has_approval {
        type_enum.insert(0, config.artifact_name.to_string());
    }
    // Questions are always available — agents can ask for clarification at any stage.
    type_enum.push("questions".to_string());
    if config.produces_subtasks {
        type_enum.push("subtasks".to_string());
    }
    if config.has_approval {
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
    if !config.produces_subtasks {
        if let Some(artifact_props) = artifact.get("properties") {
            if let Some(content) = artifact_props.get("content") {
                properties["content"] = content.clone();
            }
        }
    }

    // Add activity_log property for non-subtask, non-approval stages
    if !config.produces_subtasks && !config.has_approval {
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

    // Add questions property — always included.
    if let Some(q_props) = questions.get("properties") {
        if let Some(q) = q_props.get("questions") {
            properties["questions"] = q.clone();
        }
    }

    // Add subtasks properties if capability enabled
    if config.produces_subtasks {
        if let Some(s_props) = subtasks_component.get("properties") {
            if let Some(c) = s_props.get("content") {
                properties["content"] = c.clone();
            }
            if let Some(s) = s_props.get("subtasks") {
                properties["subtasks"] = s.clone();
            }
            if let Some(al) = s_props.get("activity_log") {
                properties["activity_log"] = al.clone();
            }
        }
    }

    // Add approval properties if capability enabled
    if config.has_approval {
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
            if let Some(rt) = a_props.get("route_to") {
                properties["route_to"] = rt.clone();
            }
        }

        // Add route_to enum if specific stage names are provided
        if !config.route_to_stages.is_empty() {
            properties["route_to"] = json!({
                "type": "string",
                "enum": config.route_to_stages,
                "description": "Stage to route to on rejection. If omitted, routes to the previous stage in the flow."
            });
        }
    }

    // Add resources property for stages with non-terminal output types.
    // Terminal states (failed, blocked) don't support resources — agents in an
    // error state shouldn't register external references. The flat schema cannot
    // restrict resources per discriminator value, so resources is included
    // whenever the stage has at least one non-terminal output type.
    // Every stage has at least one non-terminal type (artifact, subtasks, or approval).
    let resources_component = load_component(RESOURCES_COMPONENT);
    if let Some(r_props) = resources_component.get("properties") {
        if let Some(resources) = r_props.get("resources") {
            properties["resources"] = resources.clone();
        }
    }

    // Build the complete schema
    let description = if config.produces_subtasks {
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

// -- Helpers --

/// Load and parse a component schema.
fn load_component(json_str: &str) -> Value {
    serde_json::from_str(json_str).expect("component schema should be valid JSON")
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    #[test]
    fn test_generate_schema_basic() {
        let config = SchemaConfig {
            artifact_name: "plan",
            produces_subtasks: false,
            has_approval: false,
            route_to_stages: vec![],
        };
        let schema = execute(&config);
        let parsed: Value = serde_json::from_str(&schema).unwrap();

        // Should have type property with enum
        let type_prop = parsed.get("properties").unwrap().get("type").unwrap();
        let type_enum = type_prop.get("enum").unwrap().as_array().unwrap();
        assert!(type_enum.iter().any(|v| v == "plan"));
        assert!(type_enum.iter().any(|v| v == "failed"));
        assert!(type_enum.iter().any(|v| v == "blocked"));

        // Questions always included
        assert!(type_enum.iter().any(|v| v == "questions"));
        assert!(parsed.get("properties").unwrap().get("questions").is_some());

        // completed is not a valid type
        assert!(!type_enum.iter().any(|v| v == "completed"));
    }

    #[test]
    fn test_generate_schema_always_includes_questions() {
        // Questions are always present — no ask_questions flag needed
        let config = SchemaConfig {
            artifact_name: "summary",
            produces_subtasks: false,
            has_approval: false,
            route_to_stages: vec![],
        };
        let schema = execute(&config);
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

        assert!(type_enum.iter().any(|v| v == "questions"));
        assert!(parsed.get("properties").unwrap().get("questions").is_some());
    }

    #[test]
    fn test_generate_schema_with_subtasks() {
        let config = SchemaConfig {
            artifact_name: "breakdown",
            produces_subtasks: true,
            has_approval: false,
            route_to_stages: vec![],
        };
        let schema = execute(&config);
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
        // Should have subtasks and content properties (no skip_reason)
        let props = parsed.get("properties").unwrap();
        assert!(props.get("subtasks").is_some());
        assert!(props.get("skip_reason").is_none());
        assert!(props.get("content").is_some());
    }

    #[test]
    fn test_generate_schema_includes_resources() {
        // Resources property should be present for all stage types
        let configs = [
            SchemaConfig {
                artifact_name: "plan",
                produces_subtasks: false,
                has_approval: false,
                route_to_stages: vec![],
            },
            SchemaConfig {
                artifact_name: "breakdown",
                produces_subtasks: true,
                has_approval: false,
                route_to_stages: vec![],
            },
            SchemaConfig {
                artifact_name: "verdict",
                produces_subtasks: false,
                has_approval: true,
                route_to_stages: vec![],
            },
        ];

        for config in &configs {
            let schema = execute(config);
            let parsed: Value = serde_json::from_str(&schema).unwrap();
            let props = parsed.get("properties").unwrap();
            assert!(
                props.get("resources").is_some(),
                "resources property missing for artifact_name={}",
                config.artifact_name
            );
        }
    }

    #[test]
    fn test_generate_schema_with_approval() {
        let config = SchemaConfig {
            artifact_name: "verdict",
            produces_subtasks: false,
            has_approval: true,
            route_to_stages: vec![],
        };
        let schema = execute(&config);
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
    fn test_generate_schema_with_route_to_stages() {
        let config = SchemaConfig {
            artifact_name: "verdict",
            produces_subtasks: false,
            has_approval: true,
            route_to_stages: vec!["work".to_string(), "planning".to_string()],
        };
        let schema = execute(&config);
        let parsed: Value = serde_json::from_str(&schema).unwrap();

        let props = parsed.get("properties").unwrap();
        let route_to = props.get("route_to").unwrap();

        // Should be a string enum with the given stage names
        assert_eq!(route_to["type"], "string");
        let enum_vals = route_to["enum"].as_array().unwrap();
        assert!(enum_vals.iter().any(|v| v == "work"));
        assert!(enum_vals.iter().any(|v| v == "planning"));
    }

    #[test]
    fn test_generate_schema_route_to_absent_when_no_stages() {
        // When route_to_stages is empty, no route_to property
        let config = SchemaConfig {
            artifact_name: "verdict",
            produces_subtasks: false,
            has_approval: true,
            route_to_stages: vec![],
        };
        let schema = execute(&config);
        let parsed: Value = serde_json::from_str(&schema).unwrap();

        // route_to from approval.json may be present as a plain string type (no enum)
        // but not as an enum-constrained property
        let props = parsed.get("properties").unwrap();
        if let Some(route_to) = props.get("route_to") {
            // If present, it should NOT have an enum constraint (just a plain string)
            assert!(
                route_to.get("enum").is_none(),
                "route_to should not have enum when no stages provided"
            );
        }
    }
}
