//! PR description generation for task integration.
//!
//! Provides the `PrDescriptionGenerator` trait for injectable PR description generation,
//! with a production implementation (`ClaudePrDescriptionGenerator`) that uses
//! a lightweight Claude instance, and a mock for testing.

use std::fmt::Write;

use orkestra_types::domain::TokenUsage;
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

/// Context for generating a PR description.
///
/// Bundles all inputs needed by [`PrDescriptionGenerator::generate_pr_description`]
/// so the trait interface stays stable as context grows.
pub struct PrDescriptionContext<'a> {
    pub task_title: &'a str,
    pub task_description: &'a str,
    pub artifacts: &'a [PrArtifact],
    pub commits_summary: &'a str,
    pub diff_summary: &'a str,
    pub base_branch: &'a str,
    pub worktree_path: &'a str,
    pub model_names: &'a [String],
    pub token_usage: Option<&'a TokenUsage>,
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
    fn generate_pr_description(
        &self,
        ctx: &PrDescriptionContext<'_>,
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

    /// Attempt to fix a PR body that failed validation.
    ///
    /// Receives the broken PR body and a list of validation error descriptions.
    /// Returns `Ok(fixed_body)` on success, `Err(reason)` on failure.
    /// The caller handles fallback (keeping the broken body or skipping the PR).
    fn fix_pr_description(
        &self,
        task_title: &str,
        broken_body: &str,
        errors: &[String],
    ) -> Result<String, String>;
}

/// Append model attribution footer to a PR body.
pub fn format_pr_footer(model_names: &[String], token_usage: Option<&TokenUsage>) -> String {
    let mut footer = String::from("\n\n---\n\n");
    for model in model_names {
        let _ = writeln!(footer, "Co-authored-by: {model}");
    }
    if let Some(usage) = token_usage {
        if usage.input_tokens > 0 || usage.output_tokens > 0 {
            let _ = writeln!(
                footer,
                "Tokens: {} input · {} output",
                compact_number(usage.input_tokens),
                compact_number(usage.output_tokens)
            );
        }
    }
    footer.push_str("⚡ Powered by Orkestra\n");
    footer
}

#[allow(clippy::cast_precision_loss)]
fn compact_number(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
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
        ctx: &PrDescriptionContext<'_>,
    ) -> Result<(String, String), String> {
        let (title, body) = generate_pr_description_sync(
            ctx.task_title,
            ctx.task_description,
            ctx.artifacts,
            ctx.commits_summary,
            ctx.diff_summary,
            ctx.base_branch,
            ctx.worktree_path,
            300,
        )
        .map_err(|e| e.to_string())?;

        // Append model attribution footer
        let body_with_footer = format!(
            "{}{}",
            body,
            format_pr_footer(ctx.model_names, ctx.token_usage)
        );
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

    fn fix_pr_description(
        &self,
        task_title: &str,
        broken_body: &str,
        errors: &[String],
    ) -> Result<String, String> {
        fix_pr_description_sync(task_title, broken_body, errors, 120).map_err(|e| e.to_string())
    }
}

// =============================================================================
// Mock Implementation (for testing)
// =============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::{format_pr_footer, PrDescriptionGenerator};

    /// Mock PR description generator for testing.
    ///
    /// Supports configuring specific return values for each method via builder
    /// methods (`with_generate_body`, `push_fix_response`).
    pub struct MockPrDescriptionGenerator {
        fail: bool,
        /// Override body returned by `generate_pr_description` (title still comes from ctx).
        generate_body: Option<String>,
        /// Queued responses for `fix_pr_description`; pops front on each call.
        /// Falls back to default behaviour when queue is empty.
        fix_responses: Mutex<VecDeque<Result<String, String>>>,
        /// Running count of `fix_pr_description` calls.
        fix_call_count: Mutex<usize>,
        /// Recorded `broken_body` args from each `fix_pr_description` call.
        fix_received_bodies: Mutex<Vec<String>>,
        /// Recorded `errors` args from each `fix_pr_description` call.
        fix_received_errors: Mutex<Vec<Vec<String>>>,
    }

    impl MockPrDescriptionGenerator {
        /// Creates a mock that succeeds with a deterministic description.
        pub fn succeeding() -> Self {
            Self {
                fail: false,
                generate_body: None,
                fix_responses: Mutex::new(VecDeque::new()),
                fix_call_count: Mutex::new(0),
                fix_received_bodies: Mutex::new(Vec::new()),
                fix_received_errors: Mutex::new(Vec::new()),
            }
        }

        /// Creates a mock that fails, triggering the caller's fallback path.
        pub fn failing() -> Self {
            Self {
                fail: true,
                generate_body: None,
                fix_responses: Mutex::new(VecDeque::new()),
                fix_call_count: Mutex::new(0),
                fix_received_bodies: Mutex::new(Vec::new()),
                fix_received_errors: Mutex::new(Vec::new()),
            }
        }

        /// Override the body returned by `generate_pr_description`.
        ///
        /// Useful for injecting broken mermaid into the PR body so validation
        /// tests can exercise the retry loop.
        #[must_use]
        pub fn with_generate_body(mut self, body: impl Into<String>) -> Self {
            self.generate_body = Some(body.into());
            self
        }

        /// Queue a specific result for the next `fix_pr_description` call.
        ///
        /// Calls dequeue in order; once the queue is empty the mock falls back
        /// to its default behaviour (success with `_Fixed by mock_` suffix, or
        /// error when `fail = true`).
        #[must_use]
        pub fn push_fix_response(self, response: Result<String, String>) -> Self {
            self.fix_responses.lock().unwrap().push_back(response);
            self
        }

        /// Returns the total number of `fix_pr_description` calls made so far.
        pub fn fix_call_count(&self) -> usize {
            *self.fix_call_count.lock().unwrap()
        }

        /// Returns the `broken_body` argument from each `fix_pr_description` call, in order.
        pub fn fix_received_bodies(&self) -> Vec<String> {
            self.fix_received_bodies.lock().unwrap().clone()
        }

        /// Returns the `errors` argument from each `fix_pr_description` call, in order.
        pub fn fix_received_errors(&self) -> Vec<Vec<String>> {
            self.fix_received_errors.lock().unwrap().clone()
        }
    }

    impl PrDescriptionGenerator for MockPrDescriptionGenerator {
        fn generate_pr_description(
            &self,
            ctx: &super::PrDescriptionContext<'_>,
        ) -> Result<(String, String), String> {
            if self.fail {
                Err("Mock PR description generation failed".into())
            } else {
                let body = match &self.generate_body {
                    Some(b) => b.clone(),
                    None => format!(
                        "## Summary\n\n- Mock PR body\n\n## Decisions\n\n- Used existing patterns\n\n## Change Walkthrough\n\n- Mock walkthrough of changes{}",
                        format_pr_footer(ctx.model_names, ctx.token_usage)
                    ),
                };
                Ok((ctx.task_title.to_string(), body))
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

        fn fix_pr_description(
            &self,
            _task_title: &str,
            broken_body: &str,
            errors: &[String],
        ) -> Result<String, String> {
            *self.fix_call_count.lock().unwrap() += 1;
            self.fix_received_bodies
                .lock()
                .unwrap()
                .push(broken_body.to_string());
            self.fix_received_errors
                .lock()
                .unwrap()
                .push(errors.to_vec());
            // Use queued response if available.
            if let Some(queued) = self.fix_responses.lock().unwrap().pop_front() {
                return queued;
            }
            if self.fail {
                Err("Mock PR description fix failed".into())
            } else {
                Ok(format!("{broken_body}\n\n_Fixed by mock_"))
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
    use crate::runner::ExecutionMode;
    let runner = UtilityRunner::new()
        .with_model("sonnet")
        .with_timeout(timeout_secs)
        .with_mode(ExecutionMode::Interactive)
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

/// Fixes a PR description that failed validation, synchronously using a lightweight Claude instance.
///
/// Returns the corrected PR body, or an error if the fix fails.
pub fn fix_pr_description_sync(
    task_title: &str,
    broken_body: &str,
    errors: &[String],
    timeout_secs: u64,
) -> std::io::Result<String> {
    let runner = UtilityRunner::new().with_timeout(timeout_secs);
    let errors_json: Vec<serde_json::Value> = errors
        .iter()
        .map(|e| serde_json::Value::String(e.clone()))
        .collect();
    let context = json!({
        "title": task_title,
        "broken_body": broken_body,
        "errors": errors_json,
    });
    let output = runner
        .run("fix_pr_description", &context)
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
        let model_names = vec!["Claude Sonnet 4.5".to_string()];
        let artifacts = vec![
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
        ];
        let ctx = PrDescriptionContext {
            task_title: "Add feature",
            task_description: "Add new feature",
            artifacts: &artifacts,
            commits_summary: "- abc123 Add feature",
            diff_summary: "file.rs",
            base_branch: "main",
            worktree_path: "/fake/worktree",
            model_names: &model_names,
            token_usage: None,
        };
        let result = generator.generate_pr_description(&ctx);
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
        let ctx = PrDescriptionContext {
            task_title: "Add feature",
            task_description: "Add new feature",
            artifacts: &[],
            commits_summary: "",
            diff_summary: "file.rs",
            base_branch: "main",
            worktree_path: "/fake/worktree",
            model_names: &[],
            token_usage: None,
        };
        let result = generator.generate_pr_description(&ctx);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Mock PR description generation failed");
    }

    #[test]
    fn test_format_pr_footer_with_models() {
        let footer = format_pr_footer(
            &[
                "Claude Sonnet 4.5".to_string(),
                "Claude Haiku 4.5".to_string(),
            ],
            None,
        );
        assert!(footer.contains("Co-authored-by: Claude Sonnet 4.5"));
        assert!(footer.contains("Co-authored-by: Claude Haiku 4.5"));
        assert!(footer.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_format_pr_footer_empty() {
        let footer = format_pr_footer(&[], None);
        assert!(!footer.contains("Co-authored-by"));
        assert!(footer.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_format_pr_footer_with_tokens() {
        use orkestra_types::domain::TokenUsage;
        let usage = TokenUsage {
            input_tokens: 120_432,
            output_tokens: 45_200,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        };
        let footer = format_pr_footer(&["Claude Sonnet 4.5".to_string()], Some(&usage));
        assert!(footer.contains("Tokens: 120.4k input · 45.2k output"));
        assert!(footer.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_format_pr_footer_zero_tokens() {
        use orkestra_types::domain::TokenUsage;
        let usage = TokenUsage::default();
        let footer = format_pr_footer(&[], Some(&usage));
        assert!(!footer.contains("Tokens:"));
        assert!(footer.contains("⚡ Powered by Orkestra"));
    }

    #[test]
    fn test_mock_fix_pr_description_succeeding() {
        let generator = mock::MockPrDescriptionGenerator::succeeding();
        let broken_body = "## Summary\n\n- graph TD\n  A(broken) --> B";
        let errors = vec!["Mermaid node label contains parentheses: A(broken)".to_string()];
        let result = generator.fix_pr_description("Fix something", broken_body, &errors);
        assert!(result.is_ok());
        let fixed = result.unwrap();
        assert!(fixed.contains("_Fixed by mock_"));
        assert!(fixed.contains(broken_body));
    }

    #[test]
    fn test_mock_fix_pr_description_failing() {
        let generator = mock::MockPrDescriptionGenerator::failing();
        let result = generator.fix_pr_description("Fix something", "body", &["error".to_string()]);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Mock PR description fix failed");
    }

    #[test]
    fn test_compact_number_formatting() {
        assert_eq!(compact_number(0), "0");
        assert_eq!(compact_number(999), "999");
        assert_eq!(compact_number(1_000), "1.0k");
        assert_eq!(compact_number(1_500), "1.5k");
        assert_eq!(compact_number(120_432), "120.4k");
        assert_eq!(compact_number(1_200_000), "1.2M");
    }
}
