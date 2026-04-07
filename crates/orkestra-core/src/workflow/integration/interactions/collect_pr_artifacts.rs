//! Assemble the ordered artifact list for PR description generation.
//!
//! Single source of truth for collecting workflow artifacts with their stage
//! descriptions. Both PR creation and any future summary consumers use this.

use orkestra_types::config::WorkflowConfig;
use orkestra_types::domain::Task;
use orkestra_types::runtime::{resolve_artifact_path, ACTIVITY_LOG_ARTIFACT_NAME};

use crate::pr_description::PrArtifact;

/// Collect task artifacts enriched with stage descriptions and file paths, sorted by creation time.
///
/// The activity log is excluded — it is operational noise, not narrative context.
/// Descriptions come from `WorkflowConfig::stage_description_for_artifact()` — the canonical lookup.
pub fn execute(workflow: &WorkflowConfig, task: &Task) -> Vec<PrArtifact> {
    let mut artifacts: Vec<_> = task
        .artifacts
        .all()
        .filter(|a| a.name != ACTIVITY_LOG_ARTIFACT_NAME)
        .collect();
    artifacts.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    artifacts
        .into_iter()
        .map(|a| PrArtifact {
            name: a.name.clone(),
            description: workflow
                .stage_description_for_artifact(&task.flow, &a.name)
                .map(str::to_owned),
            path: resolve_artifact_path(task.worktree_path.as_deref(), &a.name),
        })
        .collect()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use orkestra_types::config::stage::StageConfig;
    use orkestra_types::config::WorkflowConfig;
    use orkestra_types::domain::Task;
    use orkestra_types::runtime::{Artifact, ACTIVITY_LOG_ARTIFACT_NAME};

    use super::execute;

    fn task_with_artifacts(artifacts: Vec<Artifact>) -> Task {
        let mut task = Task::new(
            "t1",
            "Test Task",
            "desc",
            "planning",
            "2025-01-01T00:00:00Z",
        );
        for artifact in artifacts {
            task.artifacts.set(artifact);
        }
        task
    }

    #[test]
    fn activity_log_is_excluded() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("planning", "plan")]);
        let task = task_with_artifacts(vec![
            Artifact::new(
                ACTIVITY_LOG_ARTIFACT_NAME,
                "log content",
                "planning",
                "2024-01-01T00:00:00Z",
            ),
            Artifact::new("plan", "plan content", "planning", "2025-01-01T00:00:00Z"),
        ]);

        let result = execute(&workflow, &task);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "plan");
    }

    #[test]
    fn non_log_artifacts_are_sorted_by_created_at() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ]);
        // Summary has earlier timestamp — it should sort before plan.
        let task = task_with_artifacts(vec![
            Artifact::new("plan", "plan content", "planning", "2025-01-02T00:00:00Z"),
            Artifact::new("summary", "summary content", "work", "2025-01-01T00:00:00Z"),
        ]);

        let result = execute(&workflow, &task);

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "summary");
        assert_eq!(result[1].name, "plan");
    }

    #[test]
    fn descriptions_are_populated_from_workflow_config() {
        let stage =
            StageConfig::new("planning", "plan").with_description("The implementation plan");
        let workflow = WorkflowConfig::new(vec![stage, StageConfig::new("work", "summary")]);
        let task = task_with_artifacts(vec![
            Artifact::new("plan", "plan content", "planning", "2025-01-01T00:00:00Z"),
            Artifact::new("summary", "summary content", "work", "2025-01-02T00:00:00Z"),
        ]);

        let result = execute(&workflow, &task);

        let plan = result.iter().find(|a| a.name == "plan").unwrap();
        let summary = result.iter().find(|a| a.name == "summary").unwrap();
        assert_eq!(plan.description.as_deref(), Some("The implementation plan"));
        assert!(summary.description.is_none());
    }

    #[test]
    fn activity_log_and_non_log_sort_correctly_together() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ]);
        let task = task_with_artifacts(vec![
            Artifact::new(
                ACTIVITY_LOG_ARTIFACT_NAME,
                "log",
                "planning",
                "2025-01-03T00:00:00Z",
            ),
            Artifact::new("summary", "summary content", "work", "2025-01-02T00:00:00Z"),
            Artifact::new("plan", "plan content", "planning", "2025-01-01T00:00:00Z"),
        ]);

        let result = execute(&workflow, &task);

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "plan");
        assert_eq!(result[1].name, "summary");
    }

    #[test]
    fn artifact_paths_use_resolve_artifact_path() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("planning", "plan")]);
        let task = task_with_artifacts(vec![Artifact::new(
            "plan",
            "plan content",
            "planning",
            "2025-01-01T00:00:00Z",
        )]);

        let result = execute(&workflow, &task);

        assert_eq!(result.len(), 1);
        // When no worktree_path is set, resolve_artifact_path returns relative path
        assert!(result[0].path.contains(".orkestra/.artifacts/plan.md"));
    }
}
