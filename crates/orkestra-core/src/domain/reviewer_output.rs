//! Reviewer agent structured output types.
//!
//! The reviewer agent outputs JSON indicating approval or rejection
//! of completed work, along with verification metadata.

use serde::{Deserialize, Serialize};

/// Severity level for issues found during review.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    /// Critical issue that must be fixed.
    Error,
    /// Potential problem or improvement opportunity.
    Warning,
    /// Informational note, not blocking.
    Info,
}

/// An issue found during code review.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewIssue {
    /// Severity of the issue.
    pub severity: IssueSeverity,
    /// Description of the issue.
    pub description: String,
    /// File where the issue was found (if applicable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Line number where the issue was found (if applicable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// Metadata about the review process.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ReviewMetadata {
    /// Whether tests were verified during review.
    #[serde(default)]
    pub tests_verified: bool,

    /// Whether the build was verified during review.
    #[serde(default)]
    pub build_verified: bool,

    /// Issues found during review.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub issues_found: Vec<ReviewIssue>,
}

/// Output from the reviewer agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ReviewerOutput {
    /// Work is approved and ready to merge/complete.
    Approved {
        /// Optional positive feedback or notes.
        #[serde(skip_serializing_if = "Option::is_none")]
        feedback: Option<String>,
        /// Optional metadata about what was verified.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        metadata: Option<ReviewMetadata>,
    },

    /// Work is rejected and needs changes.
    Rejected {
        /// Specific feedback about what needs to change.
        feedback: String,
        /// Optional metadata about issues found.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        metadata: Option<ReviewMetadata>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reviewer_output_approved_serialization() {
        let output = ReviewerOutput::Approved {
            feedback: Some("Clean implementation, well tested".to_string()),
            metadata: Some(ReviewMetadata {
                tests_verified: true,
                build_verified: true,
                issues_found: vec![],
            }),
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"type\": \"approved\""));
        assert!(json.contains("Clean implementation"));

        let parsed: ReviewerOutput = serde_json::from_str(&json).unwrap();
        assert_eq!(output, parsed);
    }

    #[test]
    fn test_reviewer_output_rejected_serialization() {
        let output = ReviewerOutput::Rejected {
            feedback: "Missing error handling for edge cases".to_string(),
            metadata: Some(ReviewMetadata {
                tests_verified: true,
                build_verified: true,
                issues_found: vec![
                    ReviewIssue {
                        severity: IssueSeverity::Error,
                        description: "Unwrap on Option without checking".to_string(),
                        file: Some("src/handler.rs".to_string()),
                        line: Some(42),
                    },
                    ReviewIssue {
                        severity: IssueSeverity::Warning,
                        description: "Consider adding timeout".to_string(),
                        file: Some("src/client.rs".to_string()),
                        line: None,
                    },
                ],
            }),
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"type\": \"rejected\""));
        assert!(json.contains("Missing error handling"));
        assert!(json.contains("\"severity\": \"error\""));

        let parsed: ReviewerOutput = serde_json::from_str(&json).unwrap();
        assert_eq!(output, parsed);
    }

    #[test]
    fn test_reviewer_output_minimal_approved() {
        // Minimal valid JSON (approved with no feedback or metadata)
        let json = r#"{"type": "approved"}"#;
        let parsed: ReviewerOutput = serde_json::from_str(json).unwrap();

        match parsed {
            ReviewerOutput::Approved { feedback, metadata } => {
                assert!(feedback.is_none());
                assert!(metadata.is_none());
            }
            _ => panic!("Expected Approved variant"),
        }
    }

    #[test]
    fn test_reviewer_output_minimal_rejected() {
        // Minimal valid JSON for rejection (feedback is required)
        let json = r#"{"type": "rejected", "feedback": "Needs work"}"#;
        let parsed: ReviewerOutput = serde_json::from_str(json).unwrap();

        match parsed {
            ReviewerOutput::Rejected { feedback, metadata } => {
                assert_eq!(feedback, "Needs work");
                assert!(metadata.is_none());
            }
            _ => panic!("Expected Rejected variant"),
        }
    }

    #[test]
    fn test_issue_severity_serialization() {
        assert_eq!(
            serde_json::to_string(&IssueSeverity::Error).unwrap(),
            "\"error\""
        );
        assert_eq!(
            serde_json::to_string(&IssueSeverity::Warning).unwrap(),
            "\"warning\""
        );
        assert_eq!(
            serde_json::to_string(&IssueSeverity::Info).unwrap(),
            "\"info\""
        );
    }
}
