//! Workflow overview construction.
//!
//! Builds stage entries for the workflow overview section in agent prompts.

use orkestra_types::config::WorkflowConfig;

use crate::types::WorkflowStageEntry;

// ============================================================================
// Interaction
// ============================================================================

/// Build workflow stage entries for prompt rendering.
///
/// Returns a list of all stages in the given flow (or default flow if None),
/// with their names, descriptions, and a flag indicating the current stage.
pub fn execute(
    workflow: &WorkflowConfig,
    current_stage: &str,
    flow: Option<&str>,
) -> Vec<WorkflowStageEntry> {
    workflow
        .stages_in_flow(flow)
        .into_iter()
        .map(|stage| WorkflowStageEntry {
            name: stage.name.clone(),
            description: stage.description.clone().unwrap_or_else(|| stage.display()),
            is_current: stage.name == current_stage,
        })
        .collect()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use orkestra_types::config::{FlowConfig, FlowStageEntry, StageConfig, WorkflowConfig};

    #[test]
    fn test_default_flow() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ]);

        let entries = execute(&workflow, "work", None);
        assert_eq!(entries.len(), 3);

        assert_eq!(entries[0].name, "plan");
        assert_eq!(entries[0].description, "Create a plan");
        assert!(!entries[0].is_current);

        assert_eq!(entries[1].name, "work");
        assert_eq!(entries[1].description, "Implement the plan");
        assert!(entries[1].is_current);

        assert_eq!(entries[2].name, "review");
        assert_eq!(entries[2].description, "Review");
        assert!(!entries[2].is_current);
    }

    #[test]
    fn test_with_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".into(),
            FlowConfig {
                description: "Skip breakdown".into(),
                icon: Some("zap".into()),
                stages: vec![
                    FlowStageEntry {
                        stage_name: "plan".into(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "work".into(),
                        overrides: None,
                    },
                ],
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("task", "breakdown"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ])
        .with_flows(flows);

        let entries = execute(&workflow, "work", Some("quick"));
        assert_eq!(entries.len(), 2);

        assert_eq!(entries[0].name, "plan");
        assert!(!entries[0].is_current);

        assert_eq!(entries[1].name, "work");
        assert!(entries[1].is_current);
    }

    #[test]
    fn test_nonexistent_flow() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("plan", "plan")]);

        let entries = execute(&workflow, "plan", Some("nonexistent"));
        assert!(entries.is_empty());
    }

    #[test]
    fn test_description_fallback() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_display_name("Work Stage"),
        ]);

        let entries = execute(&workflow, "work", None);
        assert_eq!(entries[0].description, "Planning");
        assert_eq!(entries[1].description, "Work Stage");
    }
}
