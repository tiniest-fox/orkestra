//! PR description generation for task integration.
//!
//! Provides the `PrDescriptionGenerator` trait for injectable PR description generation,
//! with a production implementation (`ClaudePrDescriptionGenerator`) that uses
//! a lightweight Claude instance, and a mock for testing.

use std::fmt::Write;

use serde_json::json;

use crate::runner::UtilityRunner;

// =============================================================================
// PrDescriptionGenerator Trait
// =============================================================================

/// Trait for generating PR titles and bodies from task context.
///
/// Implementations attempt to produce a GitHub PR title (max 70 chars) and
/// a structured markdown body with Summary, Decisions, and Verification sections.
/// The caller handles fallback on failure.
pub trait PrDescriptionGenerator: Send + Sync {
    /// Attempt to generate a PR title and body from task context.
    ///
    /// Returns `Ok((title, body))` on success, `Err(reason)` on failure.
    /// The body includes the model attribution footer.
    fn generate_pr_description(
        &self,
        task_title: &str,
        task_description: &str,
        plan_artifact: Option<&str>,
        diff_summary: &str,
        base_branch: &str,
        model_names: &[String],
    ) -> Result<(String, String), String>;
}

/// Append model attribution footer to a PR body.
pub fn format_pr_footer(model_names: &[String]) -> String {
    if model_names.is_empty() {
        return "\n---\n⚡ Powered by Orkestra\n".to_string();
    }
    let mut footer = String::from("\n---\n");
    for model in model_names {
        let _ = writeln!(footer, "Co-authored-by: {model}");
    }
    footer.push_str("⚡ Powered by Orkestra\n");
    footer
}

// =============================================================================
// Production Implementation
// =============================================================================

/// Production PR description generator — uses Claude haiku via `UtilityRunner`.
///
/// Spawns Claude with `--model haiku --max-turns 1` to minimize latency and cost.
/// Uses structured JSON output with schema validation for reliable results.
pub struct ClaudePrDescriptionGenerator;

impl PrDescriptionGenerator for ClaudePrDescriptionGenerator {
    fn generate_pr_description(
        &self,
        task_title: &str,
        task_description: &str,
        plan_artifact: Option<&str>,
        diff_summary: &str,
        base_branch: &str,
        model_names: &[String],
    ) -> Result<(String, String), String> {
        let (title, body) = generate_pr_description_sync(
            task_title,
            task_description,
            plan_artifact,
            diff_summary,
            base_branch,
            60,
        )
        .map_err(|e| e.to_string())?;

        // Append model attribution footer
        let body_with_footer = format!("{}{}", body, format_pr_footer(model_names));
        Ok((title, body_with_footer))
    }
}

// =============================================================================
// Mock Implementation (for testing)
// =============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::{format_pr_footer, PrDescriptionGenerator};

    /// Mock PR description generator for testing.
    ///
    /// Can simulate success (returns formatted PR description) or failure (returns error).
    pub struct MockPrDescriptionGenerator {
        fail: bool,
    }

    impl MockPrDescriptionGenerator {
        /// Creates a mock that succeeds with a deterministic description.
        pub fn succeeding() -> Self {
            Self { fail: false }
        }

        /// Creates a mock that fails, triggering the caller's fallback path.
        pub fn failing() -> Self {
            Self { fail: true }
        }
    }

    impl PrDescriptionGenerator for MockPrDescriptionGenerator {
        fn generate_pr_description(
            &self,
            task_title: &str,
            _task_description: &str,
            _plan_artifact: Option<&str>,
            _diff_summary: &str,
            _base_branch: &str,
            model_names: &[String],
        ) -> Result<(String, String), String> {
            if self.fail {
                Err("Mock PR description generation failed".into())
            } else {
                let body = format!(
                    "## Summary\n\n- Mock PR body\n\n## Decisions\n\n- Used existing patterns\n\n## Verification\n\n- Manual testing{}",
                    format_pr_footer(model_names)
                );
                Ok((task_title.to_string(), body))
            }
        }
    }
}

// =============================================================================
// PR Description Generation Helpers
// =============================================================================

/// Generates a PR description synchronously using a lightweight Claude instance.
///
/// This spawns Claude with `--model haiku --max-turns 1` to minimize latency and cost.
/// Uses structured JSON output with schema validation for reliable results.
///
/// Returns the (title, body) tuple, or an error if generation fails.
pub fn generate_pr_description_sync(
    task_title: &str,
    task_description: &str,
    plan_artifact: Option<&str>,
    diff_summary: &str,
    base_branch: &str,
    timeout_secs: u64,
) -> std::io::Result<(String, String)> {
    let runner = UtilityRunner::new().with_timeout(timeout_secs);
    let context = json!({
        "title": task_title,
        "description": task_description,
        "plan": plan_artifact.unwrap_or(""),
        "diff_summary": diff_summary,
        "base_branch": base_branch,
    });

    let output = runner
        .run("generate_pr_description", &context)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let title = output["title"]
        .as_str()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing title"))?;

    let body = output["body"]
        .as_str()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing body"))?;

    Ok((title.to_string(), body.to_string()))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_pr_description_succeeding() {
        let generator = mock::MockPrDescriptionGenerator::succeeding();
        let result = generator.generate_pr_description(
            "Add feature",
            "Add new feature",
            None,
            "file.rs",
            "main",
            &["Claude Sonnet 4.5".to_string()],
        );
        assert!(result.is_ok());
        let (title, body) = result.unwrap();
        assert_eq!(title, "Add feature");
        assert!(body.contains("## Summary"));
        assert!(body.contains("## Decisions"));
        assert!(body.contains("## Verification"));
        assert!(body.contains("Co-authored-by: Claude Sonnet 4.5"));
        assert!(body.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_mock_pr_description_failing() {
        let generator = mock::MockPrDescriptionGenerator::failing();
        let result = generator.generate_pr_description(
            "Add feature",
            "Add new feature",
            None,
            "file.rs",
            "main",
            &[],
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Mock PR description generation failed");
    }

    #[test]
    fn test_format_pr_footer_with_models() {
        let footer = format_pr_footer(&[
            "Claude Sonnet 4.5".to_string(),
            "Claude Haiku 4.5".to_string(),
        ]);
        assert!(footer.contains("Co-authored-by: Claude Sonnet 4.5"));
        assert!(footer.contains("Co-authored-by: Claude Haiku 4.5"));
        assert!(footer.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_format_pr_footer_empty() {
        let footer = format_pr_footer(&[]);
        assert!(!footer.contains("Co-authored-by"));
        assert!(footer.contains("⚡ Powered by Orkestra"));
    }
}
