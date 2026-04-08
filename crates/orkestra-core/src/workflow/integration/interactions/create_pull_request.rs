//! PR creation pipeline: commit, push, describe, create PR.

use crate::pr_description::{PrArtifact, PrDescriptionContext, PrDescriptionGenerator};
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, PrService};

/// Errors from the PR creation pipeline.
#[derive(Debug)]
#[allow(clippy::enum_variant_names)]
pub(crate) enum PrPipelineError {
    /// Required task field is missing for PR creation.
    PreconditionFailed(String),
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
            Self::PreconditionFailed(e) => write!(f, "Precondition failed: {e}"),
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
        .ok_or_else(|| PrPipelineError::PreconditionFailed("branch_name missing".into()))?;
    let worktree_path = task
        .worktree_path
        .as_deref()
        .ok_or_else(|| PrPipelineError::PreconditionFailed("worktree_path missing".into()))?;
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

    let pr_ctx = PrDescriptionContext {
        task_title: &task.title,
        task_description: &task.description,
        artifacts,
        commits_summary: &commits_summary,
        diff_summary: &diff_summary,
        base_branch,
        worktree_path,
        model_names,
    };
    let (pr_title, pr_body) = pr_desc_gen
        .generate_pr_description(&pr_ctx)
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
    use crate::workflow::ports::{CommitInfo, MockGitService, MockPrService};

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
            Err(PrPipelineError::PreconditionFailed(msg)) => {
                assert!(
                    msg.contains("branch_name missing"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected PreconditionFailed for missing branch_name, got {other:?}"),
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
            Err(PrPipelineError::PreconditionFailed(msg)) => {
                assert!(
                    msg.contains("worktree_path missing"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected PreconditionFailed for missing worktree_path, got {other:?}"),
        }
    }

    #[test]
    fn happy_path_creates_pr() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree_path = tmp.path().to_str().unwrap();

        let git = MockGitService::new();
        // has_pending_changes defaults to false — commit_worktree is a no-op
        // push_branch defaults to Ok(()) — push succeeds
        // diff_against_base defaults to Ok(TaskDiff { files: vec![] }) — empty metadata
        // commit_log_at needs explicit setup (defaults to Ok(vec![]) which gives "Commit log unavailable")
        git.push_commit_log_at_result(Ok(vec![CommitInfo {
            hash: "abc1234".to_string(),
            message: "feat: add feature".to_string(),
            body: None,
            author: "Test".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            file_count: None,
        }]));

        let pr_service = MockPrService::new();
        // Defaults to Ok("https://github.com/test/repo/pull/1")

        let pr_desc_gen = MockPrDescriptionGenerator::succeeding();

        let task = Task::new(
            "t1",
            "Add feature",
            "Add a new feature",
            "work",
            "2025-01-01T00:00:00Z",
        )
        .with_branch("task/t1")
        .with_worktree(worktree_path);

        let result = execute(
            &git,
            &pr_service,
            &pr_desc_gen,
            &task,
            &["Claude Sonnet 4.5".to_string()],
            &[],
        );

        let url = result.expect("execute should succeed");
        assert!(url.contains("github.com"), "should return PR URL");
    }
}
