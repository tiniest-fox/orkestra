//! Compact schema generation — strips description fields for prompt injection.

use serde_json::Value;

/// Strip all `description` fields from a JSON schema and return minified JSON.
///
/// Used to inject a readable but token-efficient schema reference into agent
/// prompts. The full schema (with descriptions) is still passed via `--json-schema`
/// for providers that support native enforcement.
pub fn execute(json: &str) -> String {
    let mut value: Value = serde_json::from_str(json).expect("schema should be valid JSON");
    strip_descriptions(&mut value);
    serde_json::to_string(&value).expect("schema should serialize")
}

// -- Helpers --

fn strip_descriptions(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("description");
            for v in map.values_mut() {
                strip_descriptions(v);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                strip_descriptions(v);
            }
        }
        _ => {}
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generate_stage_schema;
    use crate::types::SchemaConfig;
    use serde_json::Value;

    #[test]
    fn test_compact_schema_strips_descriptions() {
        let schema = generate_stage_schema(&SchemaConfig {
            artifact_name: "summary",
            produces_subtasks: false,
            has_approval: false,
            route_to_stages: &[],
        });
        let compact = execute(&schema);
        let parsed: Value = serde_json::from_str(&compact).unwrap();

        // Verify no description keys remain anywhere in the schema
        fn has_description(value: &Value) -> bool {
            match value {
                Value::Object(map) => {
                    if map.contains_key("description") {
                        return true;
                    }
                    map.values().any(has_description)
                }
                Value::Array(arr) => arr.iter().any(has_description),
                _ => false,
            }
        }

        assert!(
            !has_description(&parsed),
            "compact schema should have no description keys"
        );

        // Verify core structural keys are preserved
        assert!(
            parsed.get("properties").is_some(),
            "properties should remain"
        );
        assert!(parsed.get("type").is_some(), "type should remain");
    }

    #[test]
    fn test_compact_schema_preserves_structure() {
        let schema = generate_stage_schema(&SchemaConfig {
            artifact_name: "plan",
            produces_subtasks: false,
            has_approval: false,
            route_to_stages: &[],
        });
        let compact = execute(&schema);
        let parsed: Value = serde_json::from_str(&compact).unwrap();

        // required, additionalProperties, and property names should all survive
        assert!(parsed.get("required").is_some(), "required should remain");
        assert!(
            parsed.get("additionalProperties").is_some(),
            "additionalProperties should remain"
        );

        let props = parsed.get("properties").unwrap();
        assert!(props.get("type").is_some(), "type property should remain");
        assert!(
            props.get("content").is_some(),
            "content property should remain"
        );

        // enum values should remain on the type discriminator
        let type_prop = props.get("type").unwrap();
        assert!(
            type_prop.get("enum").is_some(),
            "enum should remain on type property"
        );
    }
}
