//! Query branch-specific commits for a task.

use std::path::Path;

use crate::workflow::ports::{
    CommitInfo, GitService, WorkflowError, WorkflowResult, WorkflowStore,
};

/// Commits on a task's branch plus whether the worktree has uncommitted changes.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BranchCommitsResponse {
    /// Commits on the task branch since it diverged from the base branch.
    pub commits: Vec<CommitInfo>,
    /// Whether the worktree has staged or unstaged changes.
    pub has_uncommitted_changes: bool,
}

/// Get commits on a task's branch since it diverged from the base branch.
///
/// Returns an empty response when the task has no worktree yet — nothing to show.
/// `has_uncommitted_changes` defaults to `false` when detection fails (best-effort).
pub fn execute(
    store: &dyn WorkflowStore,
    git: &dyn GitService,
    task_id: &str,
) -> WorkflowResult<BranchCommitsResponse> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let Some(worktree_path) = &task.worktree_path else {
        return Ok(BranchCommitsResponse {
            commits: vec![],
            has_uncommitted_changes: false,
        });
    };

    let commits = git
        .branch_commits(Path::new(worktree_path), &task.base_branch, 200)
        .map_err(|e| WorkflowError::GitError(e.to_string()))?;

    let has_uncommitted_changes = git
        .has_pending_changes(Path::new(worktree_path))
        .unwrap_or(false);

    Ok(BranchCommitsResponse {
        commits,
        has_uncommitted_changes,
    })
}
