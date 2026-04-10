//! JSON schema generation for agent stage outputs.
//!
//! Generates dynamic JSON schemas based on stage configuration (capabilities,
//! artifact names). Pure logic with no I/O — schemas are assembled from
//! embedded JSON component files.

pub mod examples;
pub mod generate_schema;
pub mod types;

pub use generate_schema::execute as generate_stage_schema;
use std::sync::LazyLock;
pub use types::SchemaConfig;

/// Composed planner schema — kept for convenience.
/// New code should use `generate_stage_schema` with a `SchemaConfig` instead.
pub static PLANNER_OUTPUT_SCHEMA: LazyLock<String> = LazyLock::new(|| {
    generate_stage_schema(&SchemaConfig {
        artifact_name: "plan",
        produces_subtasks: false,
        has_approval: false,
        route_to_stages: &[],
    })
});

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

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
