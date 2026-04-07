//! PR creation pipeline: commit, push, describe, create PR.

use crate::pr_description::{PrArtifact, PrDescriptionGenerator};
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
    artifacts: &[PrArtifact],
) -> Result<String, PrPipelineError> {
    let branch = task
        .branch_name
        .as_deref()
        .ok_or_else(|| PrPipelineError::CommitFailed("branch_name missing".into()))?;
    let worktree_path = task
        .worktree_path
        .as_deref()
        .ok_or_else(|| PrPipelineError::CommitFailed("worktree_path missing".into()))?;
    let worktree_dir = std::path::Path::new(worktree_path);
    let base_branch = &task.base_branch;

    // 1. Safety-net commit
    super::commit_worktree::execute(git, task, "integrating", None, None)
        .map_err(|e| PrPipelineError::CommitFailed(e.to_string()))?;

    // 2. Push branch
    git.push_branch(branch)
        .map_err(|e| PrPipelineError::PushFailed(e.to_string()))?;

    // 3. Generate PR description (with fallback on failure)
    // Use file metadata only — the interactive agent explores diffs via tools.
    // Artifacts were assembled by collect_pr_artifacts::execute() before the background thread.
    let diff_summary = super::build_diff_summary::execute_file_metadata(git, task);
    let commits_summary = super::format_commit_titles::execute(git, worktree_dir, 20);

    let (pr_title, pr_body) = pr_desc_gen
        .generate_pr_description(
            &task.title,
            &task.description,
            artifacts,
            &commits_summary,
            &diff_summary,
            base_branch,
            worktree_path,
            model_names,
        )
        .unwrap_or_else(|_| {
            // Fallback: use task title and basic body with new format + footer
            let body = format!(
                "## Summary\n\n{}\n\n## Decisions\n\n_AI generation failed_\n\n## Change Walkthrough\n\n_AI generation failed — add walkthrough manually_{}",
                task.description,
                crate::pr_description::format_pr_footer(model_names)
            );
            (task.title.clone(), body)
        });

    // 4. Create PR (idempotent — checks for existing PR first)
    pr_service
        .create_pull_request(worktree_dir, branch, base_branch, &pr_title, &pr_body)
        .map_err(|e| PrPipelineError::CreateFailed(e.to_string()))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use crate::pr_description::mock::MockPrDescriptionGenerator;
    use crate::workflow::domain::Task;
    use crate::workflow::ports::{MockGitService, MockPrService};

    use super::*;

    #[test]
    fn missing_branch_name_fails_fast() {
        let git = MockGitService::new();
        let pr_service = MockPrService::new();
        let pr_desc_gen = MockPrDescriptionGenerator::succeeding();
        // Task::new() defaults branch_name to None; set worktree so we isolate the branch guard
        let task = Task::new("t1", "title", "desc", "work", "2025-01-01T00:00:00Z")
            .with_worktree("/some/path");

        let result = execute(&git, &pr_service, &pr_desc_gen, &task, &[], &[]);

        match result {
            Err(PrPipelineError::CommitFailed(msg)) => {
                assert!(
                    msg.contains("branch_name missing"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected CommitFailed for missing branch_name, got {other:?}"),
        }
    }

    #[test]
    fn missing_worktree_path_fails_fast() {
        let git = MockGitService::new();
        let pr_service = MockPrService::new();
        let pr_desc_gen = MockPrDescriptionGenerator::succeeding();
        // Set branch_name so we pass the first guard; worktree_path remains None
        let task =
            Task::new("t1", "title", "desc", "work", "2025-01-01T00:00:00Z").with_branch("task/t1");

        let result = execute(&git, &pr_service, &pr_desc_gen, &task, &[], &[]);

        match result {
            Err(PrPipelineError::CommitFailed(msg)) => {
                assert!(
                    msg.contains("worktree_path missing"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected CommitFailed for missing worktree_path, got {other:?}"),
        }
    }
}
