//! Subtask service - organizational home for subtask-related operations.
//!
//! This service centralizes subtask operations that were previously scattered
//! across other modules, improving code organization without adding new functionality.

use crate::workflow::execution::{subtasks_to_markdown, SubtaskOutput};
use crate::workflow::runtime::Artifact;

/// Service for subtask-related operations.
///
/// Provides a centralized location for subtask handling logic,
/// reducing duplication and improving code organization.
pub struct SubtaskService;

impl SubtaskService {
    /// Create a new subtask service.
    pub fn new() -> Self {
        Self
    }

    /// Convert subtask output to a markdown artifact.
    ///
    /// This wraps the existing `subtasks_to_markdown` function and creates
    /// an Artifact ready for storage.
    pub fn create_breakdown_artifact(
        &self,
        subtasks: &[SubtaskOutput],
        skip_reason: Option<&str>,
        artifact_name: &str,
        stage: &str,
        timestamp: &str,
    ) -> Artifact {
        let content = subtasks_to_markdown(subtasks, skip_reason);
        Artifact::new(artifact_name, &content, stage, timestamp)
    }
}

impl Default for SubtaskService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_breakdown_artifact() {
        let service = SubtaskService::new();

        let subtasks = vec![
            SubtaskOutput {
                title: "First task".into(),
                description: "Do this first".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Second task".into(),
                description: "Depends on first".into(),
                depends_on: vec![0],
            },
        ];

        let artifact = service.create_breakdown_artifact(
            &subtasks,
            None,
            "breakdown",
            "breakdown",
            "2025-01-01T00:00:00Z",
        );

        assert_eq!(artifact.name, "breakdown");
        assert!(artifact.content.contains("First task"));
        assert!(artifact.content.contains("Second task"));
    }

    #[test]
    fn test_create_breakdown_artifact_empty_with_skip() {
        let service = SubtaskService::new();

        let artifact = service.create_breakdown_artifact(
            &[],
            Some("Task is simple enough"),
            "breakdown",
            "breakdown",
            "2025-01-01T00:00:00Z",
        );

        assert!(artifact.content.contains("Breakdown Skipped"));
        assert!(artifact.content.contains("Task is simple enough"));
    }
}
