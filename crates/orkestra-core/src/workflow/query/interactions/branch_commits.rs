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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::ports::{CommitInfo, InMemoryWorkflowStore, MockGitService};
    use orkestra_types::domain::Task;

    fn setup_task(store: &InMemoryWorkflowStore, task_id: &str, worktree: Option<&str>) {
        let mut task = Task::new(task_id, "Test", "", "work", "2026-01-01T00:00:00Z");
        task.worktree_path = worktree.map(std::string::ToString::to_string);
        task.base_branch = "main".to_string();
        store.save_task(&task).unwrap();
    }

    #[test]
    fn returns_empty_when_no_worktree() {
        let store = InMemoryWorkflowStore::new();
        let git = MockGitService::new();
        setup_task(&store, "t1", None);
        let result = execute(&store, &git, "t1").unwrap();
        assert!(result.commits.is_empty());
        assert!(!result.has_uncommitted_changes);
    }

    #[test]
    fn returns_commits_and_uncommitted_flag() {
        let store = InMemoryWorkflowStore::new();
        let git = MockGitService::new();
        setup_task(&store, "t1", Some("/tmp/wt"));
        git.push_branch_commits_result(Ok(vec![CommitInfo {
            hash: "abc123".into(),
            message: "test commit".into(),
            body: None,
            author: "test".into(),
            timestamp: "2026-01-01".into(),
            file_count: None,
        }]));
        git.set_has_pending_changes(true);
        let result = execute(&store, &git, "t1").unwrap();
        assert_eq!(result.commits.len(), 1);
        assert_eq!(result.commits[0].hash, "abc123");
        assert!(result.has_uncommitted_changes);
    }

    #[test]
    fn no_pending_changes_returns_false() {
        let store = InMemoryWorkflowStore::new();
        let git = MockGitService::new();
        setup_task(&store, "t1", Some("/tmp/wt"));
        // No commits configured → mock returns Ok(vec![]) by default.
        // has_pending_changes is false by default.
        let result = execute(&store, &git, "t1").unwrap();
        assert!(result.commits.is_empty());
        assert!(!result.has_uncommitted_changes);
    }

    #[test]
    fn has_uncommitted_defaults_false_on_error() {
        let store = InMemoryWorkflowStore::new();
        let git = MockGitService::new();
        setup_task(&store, "t1", Some("/tmp/wt"));
        git.set_has_pending_changes_error(orkestra_git::GitError::Other(
            "simulated failure".into(),
        ));
        let result = execute(&store, &git, "t1").unwrap();
        // The unwrap_or(false) fallback should kick in.
        assert!(!result.has_uncommitted_changes);
    }
}
