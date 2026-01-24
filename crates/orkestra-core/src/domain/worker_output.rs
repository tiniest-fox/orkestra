//! Worker agent structured output types.
//!
//! The worker agent outputs JSON indicating task completion status
//! along with metadata about what was done.

use serde::{Deserialize, Serialize};

/// Metadata about work performed by the worker agent.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkMetadata {
    /// Files that were modified during this work session.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_modified: Vec<String>,

    /// Files that were created during this work session.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_created: Vec<String>,

    /// Files that were deleted during this work session.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_deleted: Vec<String>,

    /// Whether tests were run as part of the work.
    #[serde(default)]
    pub tests_run: bool,

    /// Whether tests passed (only meaningful if tests_run is true).
    #[serde(default)]
    pub tests_passed: bool,

    /// Whether the build was checked as part of the work.
    #[serde(default)]
    pub build_checked: bool,

    /// Whether the build passed (only meaningful if build_checked is true).
    #[serde(default)]
    pub build_passed: bool,
}

/// Output from the worker agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum WorkerOutput {
    /// Work was completed successfully.
    Completed {
        /// Summary of what was accomplished.
        summary: String,
        /// Optional metadata about the work done.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        metadata: Option<WorkMetadata>,
    },

    /// Work failed and cannot be completed.
    Failed {
        /// Reason for the failure.
        reason: String,
        /// Optional metadata about what was attempted.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        metadata: Option<WorkMetadata>,
    },

    /// Work is blocked waiting for external resolution.
    Blocked {
        /// What is blocking progress.
        reason: String,
        /// Optional metadata about what was attempted.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        metadata: Option<WorkMetadata>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worker_output_completed_serialization() {
        let output = WorkerOutput::Completed {
            summary: "Implemented the authentication module".to_string(),
            metadata: Some(WorkMetadata {
                files_modified: vec!["src/auth.rs".to_string()],
                files_created: vec!["src/auth/token.rs".to_string()],
                files_deleted: vec![],
                tests_run: true,
                tests_passed: true,
                build_checked: true,
                build_passed: true,
            }),
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"type\": \"completed\""));
        assert!(json.contains("Implemented the authentication"));

        // Round-trip
        let parsed: WorkerOutput = serde_json::from_str(&json).unwrap();
        assert_eq!(output, parsed);
    }

    #[test]
    fn test_worker_output_failed_serialization() {
        let output = WorkerOutput::Failed {
            reason: "Build errors in dependencies".to_string(),
            metadata: None,
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"type\": \"failed\""));
        assert!(json.contains("Build errors"));

        let parsed: WorkerOutput = serde_json::from_str(&json).unwrap();
        assert_eq!(output, parsed);
    }

    #[test]
    fn test_worker_output_blocked_serialization() {
        let output = WorkerOutput::Blocked {
            reason: "Waiting for API credentials".to_string(),
            metadata: Some(WorkMetadata {
                files_modified: vec!["src/config.rs".to_string()],
                ..Default::default()
            }),
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"type\": \"blocked\""));
        assert!(json.contains("API credentials"));

        let parsed: WorkerOutput = serde_json::from_str(&json).unwrap();
        assert_eq!(output, parsed);
    }

    #[test]
    fn test_worker_output_minimal() {
        // Minimal valid JSON (no metadata)
        let json = r#"{"type": "completed", "summary": "Done"}"#;
        let parsed: WorkerOutput = serde_json::from_str(json).unwrap();

        match parsed {
            WorkerOutput::Completed { summary, metadata } => {
                assert_eq!(summary, "Done");
                assert!(metadata.is_none());
            }
            _ => panic!("Expected Completed variant"),
        }
    }
}
