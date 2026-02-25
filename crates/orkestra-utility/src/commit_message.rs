//! Commit message generation for task integration.
//!
//! Provides the `CommitMessageGenerator` trait for injectable commit message generation,
//! with a production implementation (`ClaudeCommitMessageGenerator`) that uses
//! a lightweight Claude instance, and a mock for testing.

use std::collections::HashSet;
use std::fmt::Write;

use serde_json::json;

use crate::runner::UtilityRunner;
use orkestra_types::config::models::friendly_model_name;
use orkestra_types::config::WorkflowConfig;

// =============================================================================
// CommitMessageGenerator Trait
// =============================================================================

/// Trait for generating commit messages from task context.
///
/// Implementations attempt to produce a conventional commit message with title and body.
/// The caller handles fallback to `fallback_commit_message` on failure.
pub trait CommitMessageGenerator: Send + Sync {
    /// Attempt to generate a commit message from task context.
    ///
    /// Returns `Ok(message)` on success, `Err(reason)` on failure.
    fn generate_commit_message(
        &self,
        task_title: &str,
        task_description: &str,
        diff_summary: &str,
        model_names: &[String],
    ) -> Result<String, String>;
}

// =============================================================================
// Production Implementation
// =============================================================================

/// Production commit message generator — uses Claude haiku via `UtilityRunner`.
///
/// Spawns Claude with `--model haiku --max-turns 1` to minimize latency and cost.
/// Uses structured JSON output with schema validation for reliable results.
pub struct ClaudeCommitMessageGenerator;

impl CommitMessageGenerator for ClaudeCommitMessageGenerator {
    fn generate_commit_message(
        &self,
        task_title: &str,
        task_description: &str,
        diff_summary: &str,
        model_names: &[String],
    ) -> Result<String, String> {
        generate_commit_message_sync(task_title, task_description, diff_summary, model_names, 60)
            .map_err(|e| e.to_string())
    }
}

// =============================================================================
// Mock Implementation (for testing)
// =============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::{format_commit_message, CommitMessageGenerator};

    /// Mock commit message generator for testing.
    ///
    /// Can simulate success (returns formatted message) or failure (returns error).
    pub struct MockCommitMessageGenerator {
        fail: bool,
    }

    impl MockCommitMessageGenerator {
        /// Creates a mock that succeeds with a deterministic message.
        pub fn succeeding() -> Self {
            Self { fail: false }
        }

        /// Creates a mock that fails, triggering the caller's fallback path.
        pub fn failing() -> Self {
            Self { fail: true }
        }
    }

    impl CommitMessageGenerator for MockCommitMessageGenerator {
        fn generate_commit_message(
            &self,
            task_title: &str,
            _task_description: &str,
            _diff_summary: &str,
            model_names: &[String],
        ) -> Result<String, String> {
            if self.fail {
                Err("Mock commit message generation failed".into())
            } else {
                Ok(format_commit_message(
                    task_title,
                    "Automated changes.",
                    model_names,
                ))
            }
        }
    }
}

// =============================================================================
// Commit Message Generation Helpers
// =============================================================================

/// Generates a commit message synchronously using a lightweight Claude instance.
///
/// This spawns Claude with `--model haiku --max-turns 1` to minimize latency and cost.
/// Uses structured JSON output with schema validation for reliable results.
///
/// Returns the formatted commit message string with trailers, or an error if generation fails.
pub fn generate_commit_message_sync(
    task_title: &str,
    task_description: &str,
    diff_summary: &str,
    model_names: &[String],
    timeout_secs: u64,
) -> std::io::Result<String> {
    let runner = UtilityRunner::new().with_timeout(timeout_secs);
    let context = json!({
        "title": task_title,
        "description": task_description,
        "diff_summary": diff_summary,
    });

    let output = runner
        .run("generate_commit_message", &context)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let title = output["title"]
        .as_str()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing title"))?;

    let body = output["body"]
        .as_str()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing body"))?;

    Ok(format_commit_message(title, body, model_names))
}

/// Format a commit message with title, body, and trailers.
///
/// Produces:
/// ```text
/// {title}
///
/// {body}
///
/// Co-authored-by: {model_name_1}
/// Co-authored-by: {model_name_2}
/// ⚡ Powered by Orkestra
/// ```
///
/// If `model_names` is empty, skip the Co-authored-by lines but keep the Orkestra line.
pub fn format_commit_message(title: &str, body: &str, model_names: &[String]) -> String {
    let mut msg = format!("{title}\n\n{body}\n");

    if !model_names.is_empty() {
        msg.push('\n');
        for model in model_names {
            let _ = writeln!(msg, "Co-authored-by: {model}");
        }
    }

    msg.push_str("\n⚡ Powered by Orkestra\n");
    msg
}

/// Collect unique model names from a workflow configuration.
///
/// Iterates all agent stages (skipping script stages), resolves effective model specs
/// using flow overrides, maps to friendly names, and deduplicates.
///
/// Always appends "Claude Haiku 4.5" (the commit message generator itself) if not present.
///
/// Returns a deduplicated list in first-occurrence order.
pub fn collect_model_names(workflow: &WorkflowConfig, task_flow: Option<&str>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut names = Vec::new();

    for model_spec in workflow.agent_model_specs(task_flow) {
        let name = friendly_model_name(model_spec.as_deref()).to_string();
        if seen.insert(name.clone()) {
            names.push(name);
        }
    }

    // Add the commit message generator model if not already present
    let utility_model = friendly_model_name(Some("haiku")).to_string();
    if seen.insert(utility_model.clone()) {
        names.push(utility_model);
    }

    names
}

/// Generate a fallback commit message when AI generation fails.
///
/// Returns the task title if non-empty, otherwise "Task {`task_id`}".
pub fn fallback_commit_message(task_title: &str, task_id: &str) -> String {
    if task_title.trim().is_empty() {
        format!("Task {task_id}")
    } else {
        task_title.to_string()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use orkestra_types::config::{IntegrationConfig, StageConfig};

    #[test]
    fn test_format_commit_message() {
        let msg = format_commit_message(
            "Add feature",
            "This adds a new feature.",
            &["Claude Sonnet 4".to_string()],
        );
        assert!(msg.starts_with("Add feature\n\nThis adds a new feature.\n\n"));
        assert!(msg.contains("Co-authored-by: Claude Sonnet 4"));
        assert!(msg.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_format_commit_message_no_models() {
        let msg = format_commit_message("Fix bug", "Fixed the issue.", &[]);
        assert!(msg.starts_with("Fix bug\n\nFixed the issue.\n\n"));
        assert!(!msg.contains("Co-authored-by:"));
        assert!(msg.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_collect_model_names_deduplication() {
        let mut planning = StageConfig::new("planning", "plan");
        planning.model = Some("sonnet".to_string());

        let mut work = StageConfig::new("work", "summary");
        work.model = Some("sonnet".to_string()); // duplicate

        let workflow = WorkflowConfig {
            version: 1,
            stages: vec![planning, work],
            integration: IntegrationConfig::new("work"),
            flows: indexmap::IndexMap::default(),
        };

        let names = collect_model_names(&workflow, None);
        assert_eq!(names.len(), 2); // "Claude Sonnet 4" (once) + "Claude Haiku 4.5"
        assert_eq!(names[0], "Claude Sonnet 4");
        assert_eq!(names[1], "Claude Haiku 4.5");
    }

    #[test]
    fn test_collect_model_names_skips_script_stages() {
        let mut planning = StageConfig::new("planning", "plan");
        planning.model = Some("sonnet".to_string());

        let checks = StageConfig::new_script("checks", "checks_result", "echo test");

        let workflow = WorkflowConfig {
            version: 1,
            stages: vec![planning, checks],
            integration: IntegrationConfig::new("work"),
            flows: indexmap::IndexMap::default(),
        };

        let names = collect_model_names(&workflow, None);
        assert_eq!(names.len(), 2); // "Claude Sonnet 4" + "Claude Haiku 4.5"
        assert!(!names.contains(&"checks".to_string()));
    }

    #[test]
    fn test_fallback_commit_message_non_empty() {
        let msg = fallback_commit_message("Add feature", "task-123");
        assert_eq!(msg, "Add feature");
    }

    #[test]
    fn test_fallback_commit_message_empty() {
        let msg = fallback_commit_message("", "task-123");
        assert_eq!(msg, "Task task-123");
    }

    #[test]
    fn test_fallback_commit_message_whitespace_only() {
        let msg = fallback_commit_message("   ", "task-123");
        assert_eq!(msg, "Task task-123");
    }

    #[test]
    fn test_collect_model_names_flow_aware() {
        use orkestra_types::config::{FlowConfig, FlowStageEntry};

        let mut planning = StageConfig::new("planning", "plan");
        planning.model = Some("sonnet".to_string());

        let mut breakdown = StageConfig::new("breakdown", "breakdown");
        breakdown.model = Some("sonnet".to_string()); // also sonnet

        let mut work = StageConfig::new("work", "summary");
        work.model = Some("opus".to_string());

        let mut review = StageConfig::new("review", "verdict");
        review.model = Some("haiku".to_string()); // explicitly haiku (not default)

        let mut flows = indexmap::IndexMap::new();
        flows.insert(
            "hotfix".to_string(),
            FlowConfig {
                description: "Hotfix flow".to_string(),
                icon: None,
                stages: vec![
                    FlowStageEntry {
                        stage_name: "work".to_string(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "review".to_string(),
                        overrides: None,
                    },
                ],
                integration: None,
            },
        );

        let workflow = WorkflowConfig {
            version: 1,
            stages: vec![planning, breakdown, work, review],
            integration: IntegrationConfig::new("work"),
            flows,
        };

        // Default flow includes all stages
        let names_default = collect_model_names(&workflow, None);
        assert!(names_default.contains(&"Claude Sonnet 4".to_string())); // planning + breakdown
        assert!(names_default.contains(&"Claude Opus 4".to_string())); // work
        assert!(names_default.contains(&"Claude Haiku 4.5".to_string())); // review + utility
        assert_eq!(names_default.len(), 3); // sonnet + opus + haiku (deduplicated)

        // Hotfix flow only includes work and review (excludes planning and breakdown)
        let names_hotfix = collect_model_names(&workflow, Some("hotfix"));
        assert!(!names_hotfix.contains(&"Claude Sonnet 4".to_string())); // planning/breakdown excluded
        assert!(names_hotfix.contains(&"Claude Opus 4".to_string())); // work included
        assert!(names_hotfix.contains(&"Claude Haiku 4.5".to_string())); // review + utility (deduplicated)
        assert_eq!(names_hotfix.len(), 2); // opus + haiku only
    }
}
