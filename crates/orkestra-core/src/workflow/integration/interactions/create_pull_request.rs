//! PR creation pipeline: commit, push, describe, create PR.

use crate::pr_description::PrDescriptionGenerator;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, PrService};

/// Errors from the PR creation pipeline.
#[derive(Debug)]
#[allow(clippy::enum_variant_names)]
pub(crate) enum PrPipelineError {
    /// Safety-net commit failed.
    CommitFailed(String),
    /// Push failed.
    PushFailed(String),
    /// PR creation on the remote failed.
    CreateFailed(String),
}

impl std::fmt::Display for PrPipelineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CommitFailed(e) => write!(f, "Commit failed: {e}"),
            Self::PushFailed(e) | Self::CreateFailed(e) => write!(f, "{e}"),
        }
    }
}

/// Execute the PR creation pipeline: commit → push → describe → create PR.
///
/// Pure business logic — no API lock, no result recording. Returns the PR URL
/// on success or a typed error for each failure mode.
pub(crate) fn execute(
    git: &dyn GitService,
    pr_service: &dyn PrService,
    pr_desc_gen: &dyn PrDescriptionGenerator,
    task: &Task,
    model_names: &[String],
) -> Result<String, PrPipelineError> {
    let branch = task.branch_name.clone().unwrap_or_default();
    let base_branch = &task.base_branch;

    // 1. Safety-net commit
    super::commit_worktree::execute(git, task, "integrating", None, None)
        .map_err(|e| PrPipelineError::CommitFailed(e.to_string()))?;

    // 2. Push branch
    git.push_branch(&branch)
        .map_err(|e| PrPipelineError::PushFailed(e.to_string()))?;

    // 3. Generate PR description (with fallback on failure)
    let diff_summary = super::build_diff_summary::execute(git, task);

    // Get plan artifact if available for richer PR body
    let plan_artifact = task.artifacts.get("plan").map(|a| a.content.as_str());

    let (pr_title, pr_body) = pr_desc_gen
        .generate_pr_description(
            &task.title,
            &task.description,
            plan_artifact,
            &diff_summary,
            base_branch,
            model_names,
        )
        .unwrap_or_else(|_| {
            // Fallback: use task title and basic body with new format + footer
            let body = format!(
                "## Summary\n\n{}\n\n## Decisions\n\n_AI generation failed_\n\n## Verification\n\n_Manual verification required_{}",
                task.description,
                crate::pr_description::format_pr_footer(model_names)
            );
            (task.title.clone(), body)
        });

    // 4. Create PR (idempotent — checks for existing PR first)
    let repo_root = task
        .worktree_path
        .as_deref()
        .map_or_else(|| std::path::Path::new("."), std::path::Path::new);
    pr_service
        .create_pull_request(repo_root, &branch, base_branch, &pr_title, &pr_body)
        .map_err(|e| PrPipelineError::CreateFailed(e.to_string()))
}
