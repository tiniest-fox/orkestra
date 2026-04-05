//! Workflow overview construction.
//!
//! Builds stage entries for the workflow overview section in agent prompts.

use orkestra_types::config::WorkflowConfig;
use orkestra_types::runtime::resolve_artifact_path;

use crate::types::WorkflowStageEntry;

// ============================================================================
// Interaction
// ============================================================================

/// Build workflow stage entries for prompt rendering.
///
/// Returns a list of all stages in the given flow, with their names, descriptions,
/// a flag indicating the current stage, and artifact paths for stages that have
/// already produced materialized artifacts.
///
/// `artifact_names` — set of artifact names that have been materialized to the worktree.
/// `worktree_path` — absolute path to the task's worktree; used to compute absolute artifact paths.
pub fn execute(
    workflow: &WorkflowConfig,
    current_stage: &str,
    flow: &str,
    artifact_names: &[String],
    worktree_path: Option<&str>,
) -> Vec<WorkflowStageEntry> {
    let stages = workflow.stages_in_flow(flow);
    let current_pos = stages.iter().position(|s| s.name == current_stage);

    stages
        .into_iter()
        .enumerate()
        .map(|(i, stage)| {
            let is_current = stage.name == current_stage;

            // Show artifact path only for stages that come before the current stage
            // and whose artifact has been materialized.
            let artifact_path = if current_pos.is_some_and(|pos| i < pos)
                && artifact_names.iter().any(|n| n == stage.artifact_name())
            {
                Some(resolve_artifact_path(worktree_path, stage.artifact_name()))
            } else {
                None
            };

            WorkflowStageEntry {
                name: stage.name.clone(),
                display_name: stage.display(),
                description: stage.description.clone(),
                is_current,
                artifact_path,
            }
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
    use orkestra_types::config::{FlowConfig, IntegrationConfig, StageConfig, WorkflowConfig};

    #[test]
    fn test_default_flow() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ]);

        let entries = execute(&workflow, "work", "default", &[], None);
        assert_eq!(entries.len(), 3);

        assert_eq!(entries[0].name, "plan");
        assert_eq!(entries[0].display_name, "Plan");
        assert_eq!(entries[0].description, Some("Create a plan".to_string()));
        assert!(!entries[0].is_current);

        assert_eq!(entries[1].name, "work");
        assert_eq!(entries[1].display_name, "Work");
        assert_eq!(
            entries[1].description,
            Some("Implement the plan".to_string())
        );
        assert!(entries[1].is_current);

        assert_eq!(entries[2].name, "review");
        assert_eq!(entries[2].display_name, "Review");
        assert_eq!(entries[2].description, None);
        assert!(!entries[2].is_current);
    }

    #[test]
    fn test_with_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".into(),
            FlowConfig {
                stages: vec![
                    StageConfig::new("plan", "plan").with_description("Create a plan"),
                    StageConfig::new("work", "summary").with_description("Implement the plan"),
                ],
                integration: IntegrationConfig::new("plan"),
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("task", "breakdown"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ])
        .with_flows(flows);

        let entries = execute(&workflow, "work", "quick", &[], None);
        assert_eq!(entries.len(), 2);

        assert_eq!(entries[0].name, "plan");
        assert!(!entries[0].is_current);

        assert_eq!(entries[1].name, "work");
        assert!(entries[1].is_current);
    }

    #[test]
    fn test_nonexistent_flow() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("plan", "plan")]);

        let entries = execute(&workflow, "plan", "nonexistent", &[], None);
        assert!(entries.is_empty());
    }

    #[test]
    fn test_display_title_cases_name() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work_review", "verdict"),
        ]);

        let entries = execute(&workflow, "planning", "default", &[], None);
        assert_eq!(entries[0].display_name, "Planning");
        assert_eq!(entries[0].description, None);
        assert_eq!(entries[1].display_name, "Work Review");
        assert_eq!(entries[1].description, None);
    }

    #[test]
    fn test_description_field() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan").with_description("Understand the task"),
            StageConfig::new("work", "summary"),
        ]);

        let entries = execute(&workflow, "work", "default", &[], None);
        assert_eq!(
            entries[0].description,
            Some("Understand the task".to_string())
        );
        assert_eq!(entries[1].description, None);
    }

    #[test]
    fn test_artifact_path_for_prior_completed_stages() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("task", "breakdown").with_description("Break it down"),
            StageConfig::new("work", "summary").with_description("Implement"),
            StageConfig::new("review", "verdict").with_description("Review"),
        ]);

        // "plan" artifact is materialized; "breakdown" is not.
        let artifact_names = vec!["plan".to_string()];
        let entries = execute(
            &workflow,
            "work",
            "default",
            &artifact_names,
            Some("/worktrees/my-task"),
        );

        // plan: before current, artifact materialized → has path
        assert!(entries[0].artifact_path.is_some());
        assert!(entries[0].artifact_path.as_ref().unwrap().contains("plan"));

        // task: before current, artifact NOT materialized → no path
        assert!(entries[1].artifact_path.is_none());

        // work: is current → no path
        assert!(entries[2].artifact_path.is_none());

        // review: after current → no path
        assert!(entries[3].artifact_path.is_none());
    }

    #[test]
    fn test_current_and_future_stages_have_no_artifact_path() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement"),
            StageConfig::new("review", "verdict").with_description("Review"),
        ]);

        // All artifacts materialized — but current and future should still get None.
        let artifact_names = vec![
            "plan".to_string(),
            "summary".to_string(),
            "verdict".to_string(),
        ];
        let entries = execute(&workflow, "work", "default", &artifact_names, None);

        // plan: before current, materialized → path present
        assert!(entries[0].artifact_path.is_some());
        // work: is current → no path
        assert!(entries[1].artifact_path.is_none());
        // review: after current → no path
        assert!(entries[2].artifact_path.is_none());
    }
}
