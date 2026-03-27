//! Assemble the ordered artifact list for PR description generation.
//!
//! Single source of truth for collecting workflow artifacts with their stage
//! descriptions. Both PR creation and any future summary consumers use this.

use orkestra_types::config::WorkflowConfig;
use orkestra_types::domain::Task;
use orkestra_types::runtime::ACTIVITY_LOG_ARTIFACT_NAME;

use crate::pr_description::PrArtifact;

/// Collect all task artifacts enriched with stage descriptions, sorted by creation time.
///
/// The activity log is placed last since it spans all stages. Artifact descriptions
/// come from `WorkflowConfig::artifact_description()` — the canonical lookup.
pub fn execute(workflow: &WorkflowConfig, task: &Task) -> Vec<PrArtifact> {
    let mut artifacts: Vec<_> = task.artifacts.all().collect();
    artifacts.sort_by(|a, b| {
        let a_is_log = a.name == ACTIVITY_LOG_ARTIFACT_NAME;
        let b_is_log = b.name == ACTIVITY_LOG_ARTIFACT_NAME;
        match (a_is_log, b_is_log) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => a.created_at.cmp(&b.created_at),
        }
    });

    artifacts
        .into_iter()
        .map(|a| PrArtifact {
            name: a.name.clone(),
            description: workflow.artifact_description(&a.name).map(str::to_owned),
            content: a.content.clone(),
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
    fn activity_log_is_always_last_regardless_of_created_at() {
        // Activity log has an earlier timestamp than the plan, but must sort last.
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

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "plan");
        assert_eq!(result[1].name, ACTIVITY_LOG_ARTIFACT_NAME);
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
        let mut stage = StageConfig::new("planning", "plan");
        stage.artifact.description = Some("The implementation plan".into());
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

        assert_eq!(result.len(), 3);
        assert_eq!(result[0].name, "plan");
        assert_eq!(result[1].name, "summary");
        assert_eq!(result[2].name, ACTIVITY_LOG_ARTIFACT_NAME);
    }
}
