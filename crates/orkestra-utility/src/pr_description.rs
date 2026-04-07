//! PR description generation for task integration.
//!
//! Provides the `PrDescriptionGenerator` trait for injectable PR description generation,
//! with a production implementation (`ClaudePrDescriptionGenerator`) that uses
//! a lightweight Claude instance, and a mock for testing.

use std::fmt::Write;

use serde_json::json;

use crate::runner::UtilityRunner;

// =============================================================================
// Types
// =============================================================================

/// A workflow artifact with its name, optional stage description, and file path.
///
/// Passed to [`PrDescriptionGenerator`] so the PR description has context
/// about what each stage produced. Assembled by `collect_pr_artifacts::execute()`
/// in orkestra-core, which is the single source of truth for this collection.
#[derive(Debug, Clone)]
pub struct PrArtifact {
    /// Artifact name (e.g. "plan", "summary").
    pub name: String,
    /// Human-readable description from the stage config, if set.
    pub description: Option<String>,
    /// File path where the artifact content can be found.
    pub path: String,
}

// =============================================================================
// PrDescriptionGenerator Trait
// =============================================================================

/// Trait for generating PR titles and bodies from task context.
///
/// Implementations attempt to produce a GitHub PR title (max 70 chars) and
/// a structured markdown body with Summary, Decisions, and Change Walkthrough sections.
/// The caller handles fallback on failure.
pub trait PrDescriptionGenerator: Send + Sync {
    /// Attempt to generate a PR title and body from task context.
    ///
    /// Returns `Ok((title, body))` on success, `Err(reason)` on failure.
    /// The body includes the model attribution footer.
    ///
    /// `artifacts` contains workflow stage artifact references (name, description, path),
    /// assembled by `collect_pr_artifacts::execute()` in workflow stage order.
    #[allow(clippy::too_many_arguments)]
    fn generate_pr_description(
        &self,
        task_title: &str,
        task_description: &str,
        artifacts: &[PrArtifact],
        commits_summary: &str,
        diff_summary: &str,
        base_branch: &str,
        worktree_path: &str,
        model_names: &[String],
    ) -> Result<(String, String), String>;

    /// Attempt to update an existing PR body to reflect the current branch state.
    ///
    /// Receives the current PR body and the current branch state (commits + diff).
    /// Returns `Ok(updated_body)` on success, `Err(reason)` on failure.
    /// The caller handles fallback (keeping the existing body unchanged).
    fn update_pr_description(
        &self,
        task_title: &str,
        current_body: &str,
        commits_summary: &str,
        diff_summary: &str,
    ) -> Result<String, String>;
}

/// Append model attribution footer to a PR body.
pub fn format_pr_footer(model_names: &[String]) -> String {
    if model_names.is_empty() {
        return "\n\n---\n\n⚡ Powered by Orkestra\n".to_string();
    }
    let mut footer = String::from("\n\n---\n\n");
    for model in model_names {
        let _ = writeln!(footer, "Co-authored-by: {model}");
    }
    footer.push_str("⚡ Powered by Orkestra\n");
    footer
}

// =============================================================================
// Production Implementation
// =============================================================================

/// Production PR description generator — runs Claude Sonnet as an interactive agent in the task worktree.
///
/// Spawns Claude with `--model sonnet` in interactive mode with a 5-minute timeout,
/// giving the agent access to tools (git log, diff, etc.) so it can read context directly.
/// Returns the agent's final output as the PR description.
pub struct ClaudePrDescriptionGenerator;

impl PrDescriptionGenerator for ClaudePrDescriptionGenerator {
    fn generate_pr_description(
        &self,
        task_title: &str,
        task_description: &str,
        artifacts: &[PrArtifact],
        commits_summary: &str,
        diff_summary: &str,
        base_branch: &str,
        worktree_path: &str,
        model_names: &[String],
    ) -> Result<(String, String), String> {
        let (title, body) = generate_pr_description_sync(
            task_title,
            task_description,
            artifacts,
            commits_summary,
            diff_summary,
            base_branch,
            worktree_path,
            300,
        )
        .map_err(|e| e.to_string())?;

        // Append model attribution footer
        let body_with_footer = format!("{}{}", body, format_pr_footer(model_names));
        Ok((title, body_with_footer))
    }

    fn update_pr_description(
        &self,
        task_title: &str,
        current_body: &str,
        commits_summary: &str,
        diff_summary: &str,
    ) -> Result<String, String> {
        update_pr_description_sync(task_title, current_body, commits_summary, diff_summary, 120)
            .map_err(|e| e.to_string())
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
            _artifacts: &[super::PrArtifact],
            _commits_summary: &str,
            _diff_summary: &str,
            _base_branch: &str,
            _worktree_path: &str,
            model_names: &[String],
        ) -> Result<(String, String), String> {
            if self.fail {
                Err("Mock PR description generation failed".into())
            } else {
                let body = format!(
                    "## Summary\n\n- Mock PR body\n\n## Decisions\n\n- Used existing patterns\n\n## Change Walkthrough\n\n- Mock walkthrough of changes{}",
                    format_pr_footer(model_names)
                );
                Ok((task_title.to_string(), body))
            }
        }

        fn update_pr_description(
            &self,
            _task_title: &str,
            current_body: &str,
            _commits_summary: &str,
            _diff_summary: &str,
        ) -> Result<String, String> {
            if self.fail {
                Err("Mock PR description update failed".into())
            } else {
                Ok(format!("{current_body}\n\n_Updated by mock_"))
            }
        }
    }
}

// =============================================================================
// PR Description Generation Helpers
// =============================================================================

/// Generates a PR description synchronously using an interactive Claude agent in the worktree.
///
/// Spawns Claude in interactive mode with tool access so the agent can explore the diff,
/// read files, and examine artifacts before writing. Uses Sonnet for better reasoning quality
/// and a 5-minute timeout to allow thorough exploration.
///
/// Returns the (title, body) tuple, or an error if generation fails.
#[allow(clippy::too_many_arguments)]
pub fn generate_pr_description_sync(
    task_title: &str,
    task_description: &str,
    artifacts: &[PrArtifact],
    commits_summary: &str,
    diff_summary: &str,
    base_branch: &str,
    worktree_path: &str,
    timeout_secs: u64,
) -> std::io::Result<(String, String)> {
    let runner = UtilityRunner::new()
        .with_model("sonnet")
        .with_timeout(timeout_secs)
        .with_interactive(true)
        .with_cwd(worktree_path);
    let artifact_list: Vec<_> = artifacts
        .iter()
        .map(|a| {
            json!({
                "name": a.name,
                "description": a.description,
                "path": a.path,
            })
        })
        .collect();
    let context = json!({
        "title": task_title,
        "description": task_description,
        "artifacts": artifact_list,
        "commits": commits_summary,
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

/// Updates an existing PR description synchronously using a lightweight Claude instance.
///
/// Returns the complete updated PR body, or an error if generation fails.
pub fn update_pr_description_sync(
    task_title: &str,
    current_body: &str,
    commits_summary: &str,
    diff_summary: &str,
    timeout_secs: u64,
) -> std::io::Result<String> {
    let runner = UtilityRunner::new().with_timeout(timeout_secs);
    let context = json!({
        "title": task_title,
        "current_body": current_body,
        "commits": commits_summary,
        "diff_summary": diff_summary,
    });
    let output = runner
        .run("update_pr_description", &context)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    output["body"]
        .as_str()
        .map(std::string::ToString::to_string)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing body"))
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
            &[
                PrArtifact {
                    name: "plan".into(),
                    description: Some("The plan".into()),
                    path: "/worktree/.orkestra/.artifacts/plan.md".into(),
                },
                PrArtifact {
                    name: "summary".into(),
                    description: None,
                    path: "/worktree/.orkestra/.artifacts/summary.md".into(),
                },
            ],
            "- abc123 Add feature",
            "file.rs",
            "main",
            "/fake/worktree",
            &["Claude Sonnet 4.5".to_string()],
        );
        assert!(result.is_ok());
        let (title, body) = result.unwrap();
        assert_eq!(title, "Add feature");
        assert!(body.contains("## Summary"));
        assert!(body.contains("## Decisions"));
        assert!(body.contains("## Change Walkthrough"));
        assert!(body.contains("Co-authored-by: Claude Sonnet 4.5"));
        assert!(body.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_mock_pr_description_failing() {
        let generator = mock::MockPrDescriptionGenerator::failing();
        let result = generator.generate_pr_description(
            "Add feature",
            "Add new feature",
            &[] as &[PrArtifact],
            "",
            "file.rs",
            "main",
            "/fake/worktree",
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
