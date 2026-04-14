//! Persistent artifact record produced by a workflow stage.
//!
//! Each agent output that produces an artifact is stored as a `WorkflowArtifact`
//! row in the `workflow_artifacts` table, enabling artifact history across
//! rejection cycles without storing content on the iteration row itself.

use serde::{Deserialize, Serialize};

/// A named artifact produced by a workflow stage during an iteration.
///
/// Stored in the `workflow_artifacts` table. Each accepted agent output
/// that carries artifact content creates one row here. The `iteration_id`
/// links back to the active iteration when the artifact was produced.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowArtifact {
    /// Unique identifier for this artifact record.
    pub id: String,

    /// ID of the task this artifact belongs to.
    pub task_id: String,

    /// ID of the iteration that produced this artifact, if known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iteration_id: Option<String>,

    /// Stage name (e.g., "planning", "work") that produced this artifact.
    pub stage: String,

    /// Artifact slot name (e.g., "plan", "breakdown", "summary").
    pub name: String,

    /// Artifact content (markdown).
    pub content: String,

    /// When this artifact was produced (RFC3339).
    pub created_at: String,
}

impl WorkflowArtifact {
    /// Create a new workflow artifact.
    pub fn new(
        id: impl Into<String>,
        task_id: impl Into<String>,
        stage: impl Into<String>,
        name: impl Into<String>,
        content: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            task_id: task_id.into(),
            iteration_id: None,
            stage: stage.into(),
            name: name.into(),
            content: content.into(),
            created_at: created_at.into(),
        }
    }

    /// Builder: associate this artifact with an iteration.
    #[must_use]
    pub fn with_iteration_id(mut self, iteration_id: impl Into<String>) -> Self {
        self.iteration_id = Some(iteration_id.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workflow_artifact_new() {
        let artifact = WorkflowArtifact::new(
            "art-1",
            "task-1",
            "planning",
            "plan",
            "# Plan\n\nDo the thing.",
            "2025-01-24T10:00:00Z",
        );
        assert_eq!(artifact.id, "art-1");
        assert_eq!(artifact.task_id, "task-1");
        assert_eq!(artifact.stage, "planning");
        assert_eq!(artifact.name, "plan");
        assert!(artifact.iteration_id.is_none());
    }

    #[test]
    fn test_workflow_artifact_with_iteration_id() {
        let artifact = WorkflowArtifact::new(
            "art-1",
            "task-1",
            "work",
            "summary",
            "content",
            "2025-01-24T10:00:00Z",
        )
        .with_iteration_id("iter-1");
        assert_eq!(artifact.iteration_id, Some("iter-1".to_string()));
    }

    #[test]
    fn test_workflow_artifact_serialization() {
        let artifact = WorkflowArtifact::new(
            "art-1",
            "task-1",
            "planning",
            "plan",
            "# Plan",
            "2025-01-24T10:00:00Z",
        )
        .with_iteration_id("iter-1");

        let json = serde_json::to_string(&artifact).unwrap();
        assert!(json.contains("\"id\":\"art-1\""));
        assert!(json.contains("\"name\":\"plan\""));
        assert!(json.contains("\"iteration_id\":\"iter-1\""));

        let parsed: WorkflowArtifact = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, artifact);
    }

    #[test]
    fn test_workflow_artifact_serialization_no_iteration() {
        let artifact = WorkflowArtifact::new(
            "art-1",
            "task-1",
            "planning",
            "plan",
            "# Plan",
            "2025-01-24T10:00:00Z",
        );

        let json = serde_json::to_string(&artifact).unwrap();
        // iteration_id should be omitted when None
        assert!(!json.contains("iteration_id"));

        let parsed: WorkflowArtifact = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, artifact);
    }
}
