//! Commit message generation for task integration.
//!
//! Provides the `CommitMessageGenerator` trait for injectable commit message generation,
//! with a production implementation (`ClaudeCommitMessageGenerator`) that uses
//! a lightweight Claude instance, and a mock for testing.

use std::collections::HashSet;
use std::fmt::Write;

use serde_json::json;

use crate::utility::UtilityRunner;
use crate::workflow::config::WorkflowConfig;

/// Display name for the utility model used by commit message generation.
/// Must match the model used by `UtilityRunner::new()` (currently haiku).
const UTILITY_MODEL_DISPLAY_NAME: &str = "Claude Haiku 4.5";

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
pub(crate) fn generate_commit_message_sync(
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
pub(crate) fn format_commit_message(title: &str, body: &str, model_names: &[String]) -> String {
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

/// Map a model spec to a friendly display name for Co-authored-by.
///
/// Static lookup table for known models:
/// - `None` → "Claude Sonnet 4.5" (default)
/// - Aliases like "sonnet", "opus", "haiku" → Claude model names
/// - Provider-prefixed like "claudecode/sonnet" → Claude model names
/// - `OpenCode` models like "kimi-k2.5" → Kimi model names
/// - Unknown specs → return the raw string
pub fn friendly_model_name(model_spec: Option<&str>) -> &str {
    match model_spec {
        None => "Claude Sonnet 4.5",
        Some(spec) => match spec {
            // Claude Sonnet — alias, provider-prefixed, and raw model ID
            "sonnet" | "claudecode/sonnet" | "claude-sonnet-4-5-20250929" => "Claude Sonnet 4.5",
            // Claude Opus
            "opus" | "claudecode/opus" | "claude-opus-4-5-20251101" => "Claude Opus 4.5",
            // Claude Haiku
            "haiku" | "claudecode/haiku" | "claude-haiku-4-5-20251001" => "Claude Haiku 4.5",
            // Kimi K2.5
            "kimi-k2.5" | "opencode/kimi-k2.5" | "opencode/kimi-k2.5-free" => "Kimi K2.5",
            // Kimi K2
            "kimi-k2" | "opencode/kimi-k2" | "moonshot/kimi-k2-0711-preview" => "Kimi K2",
            // Unknown — return raw spec
            _ => spec,
        },
    }
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
    let utility_model = UTILITY_MODEL_DISPLAY_NAME.to_string();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{StageConfig, WorkflowConfig};

    #[test]
    fn test_friendly_model_name_default() {
        assert_eq!(friendly_model_name(None), "Claude Sonnet 4.5");
    }

    #[test]
    fn test_friendly_model_name_aliases() {
        assert_eq!(friendly_model_name(Some("sonnet")), "Claude Sonnet 4.5");
        assert_eq!(friendly_model_name(Some("opus")), "Claude Opus 4.5");
        assert_eq!(friendly_model_name(Some("haiku")), "Claude Haiku 4.5");
    }

    #[test]
    fn test_friendly_model_name_provider_prefixed() {
        assert_eq!(
            friendly_model_name(Some("claudecode/sonnet")),
            "Claude Sonnet 4.5"
        );
        assert_eq!(
            friendly_model_name(Some("claudecode/opus")),
            "Claude Opus 4.5"
        );
        assert_eq!(
            friendly_model_name(Some("claudecode/haiku")),
            "Claude Haiku 4.5"
        );
    }

    #[test]
    fn test_friendly_model_name_raw_model_ids() {
        assert_eq!(
            friendly_model_name(Some("claude-sonnet-4-5-20250929")),
            "Claude Sonnet 4.5"
        );
        assert_eq!(
            friendly_model_name(Some("claude-opus-4-5-20251101")),
            "Claude Opus 4.5"
        );
        assert_eq!(
            friendly_model_name(Some("claude-haiku-4-5-20251001")),
            "Claude Haiku 4.5"
        );
        assert_eq!(
            friendly_model_name(Some("moonshot/kimi-k2-0711-preview")),
            "Kimi K2"
        );
        assert_eq!(
            friendly_model_name(Some("opencode/kimi-k2.5-free")),
            "Kimi K2.5"
        );
    }

    #[test]
    fn test_friendly_model_name_kimi() {
        assert_eq!(friendly_model_name(Some("kimi-k2.5")), "Kimi K2.5");
        assert_eq!(friendly_model_name(Some("kimi-k2")), "Kimi K2");
        assert_eq!(friendly_model_name(Some("opencode/kimi-k2.5")), "Kimi K2.5");
        assert_eq!(friendly_model_name(Some("opencode/kimi-k2")), "Kimi K2");
    }

    #[test]
    fn test_friendly_model_name_unknown() {
        assert_eq!(friendly_model_name(Some("unknown-model")), "unknown-model");
    }

    #[test]
    fn test_friendly_model_name_unknown_passes_through() {
        assert_eq!(
            friendly_model_name(Some("some-new-model")),
            "some-new-model"
        );
        // Verify old contains-based false positives no longer match
        assert_eq!(
            friendly_model_name(Some("my-custom-opus-variant")),
            "my-custom-opus-variant"
        );
    }

    #[test]
    fn test_format_commit_message() {
        let msg = format_commit_message(
            "Add feature",
            "This adds a new feature.",
            &["Claude Sonnet 4.5".to_string()],
        );
        assert!(msg.starts_with("Add feature\n\nThis adds a new feature.\n\n"));
        assert!(msg.contains("Co-authored-by: Claude Sonnet 4.5"));
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
            integration: crate::workflow::config::IntegrationConfig::default(),
            flows: indexmap::IndexMap::default(),
        };

        let names = collect_model_names(&workflow, None);
        assert_eq!(names.len(), 2); // "Claude Sonnet 4.5" (once) + "Claude Haiku 4.5"
        assert_eq!(names[0], "Claude Sonnet 4.5");
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
            integration: crate::workflow::config::IntegrationConfig::default(),
            flows: indexmap::IndexMap::default(),
        };

        let names = collect_model_names(&workflow, None);
        assert_eq!(names.len(), 2); // "Claude Sonnet 4.5" + "Claude Haiku 4.5"
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
        use crate::workflow::config::FlowConfig;
        use crate::workflow::config::FlowStageEntry;

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
            integration: crate::workflow::config::IntegrationConfig::default(),
            flows,
        };

        // Default flow includes all stages
        let names_default = collect_model_names(&workflow, None);
        assert!(names_default.contains(&"Claude Sonnet 4.5".to_string())); // planning + breakdown
        assert!(names_default.contains(&"Claude Opus 4.5".to_string())); // work
        assert!(names_default.contains(&"Claude Haiku 4.5".to_string())); // review + utility
        assert_eq!(names_default.len(), 3); // sonnet + opus + haiku (deduplicated)

        // Hotfix flow only includes work and review (excludes planning and breakdown)
        let names_hotfix = collect_model_names(&workflow, Some("hotfix"));
        assert!(!names_hotfix.contains(&"Claude Sonnet 4.5".to_string())); // planning/breakdown excluded
        assert!(names_hotfix.contains(&"Claude Opus 4.5".to_string())); // work included
        assert!(names_hotfix.contains(&"Claude Haiku 4.5".to_string())); // review + utility (deduplicated)
        assert_eq!(names_hotfix.len(), 2); // opus + haiku only
    }
}
