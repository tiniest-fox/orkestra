//! Create a git worktree for a task.

use git2::Repository;
use std::path::Path;
use std::sync::Mutex;

use crate::types::{GitError, WorktreeCreated};

/// Create a worktree if it doesn't exist, or return existing info.
///
/// Does NOT run the setup script — the caller handles that separately.
pub fn execute(
    repo: &Mutex<Repository>,
    worktrees_dir: &Path,
    task_id: &str,
    base_branch: Option<&str>,
) -> Result<WorktreeCreated, GitError> {
    let branch_name = format!("task/{task_id}");
    let worktree_path = worktrees_dir.join(task_id);

    // If worktree already exists, return its info
    if super::exists::execute(repo, task_id) {
        let base_commit =
            crate::interactions::branch::get_commit_oid::execute(repo, Some(&branch_name))
                .map(|oid| oid.to_string())?;
        return Ok(WorktreeCreated {
            branch_name,
            worktree_path,
            base_commit,
        });
    }

    // Ensure worktrees directory exists
    std::fs::create_dir_all(worktrees_dir)?;

    // Prefer origin/{branch} so worktrees start from the remote tip even when
    // the local branch ref is stale. Falls back to local resolution for repos
    // with no remote (test repos).
    let commit_oid = match base_branch {
        Some(branch) => resolve_remote_commit_oid(repo, branch)
            .or_else(|_| crate::interactions::branch::get_commit_oid::execute(repo, Some(branch)))
            .map_err(|_| {
                GitError::BranchError(format!(
                    "Base branch '{branch}' not found (remote or local) — the parent task's branch may have been deleted"
                ))
            })?,
        None => crate::interactions::branch::get_commit_oid::execute(repo, None)?,
    };

    // Create the branch
    crate::interactions::branch::create_from_oid::execute(repo, &branch_name, commit_oid)?;

    // Create the worktree
    super::create_for_branch::execute(repo, task_id, &branch_name, &worktree_path)?;

    Ok(WorktreeCreated {
        branch_name,
        worktree_path,
        base_commit: commit_oid.to_string(),
    })
}

// -- Helpers --

fn resolve_remote_commit_oid(
    repo: &Mutex<Repository>,
    base_branch: &str,
) -> Result<git2::Oid, GitError> {
    let repo = repo
        .lock()
        .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;
    let remote_name = format!("origin/{base_branch}");
    let branch_ref = repo
        .find_branch(&remote_name, git2::BranchType::Remote)
        .map_err(|e| {
            GitError::BranchError(format!("Failed to find remote branch '{remote_name}': {e}"))
        })?;
    let commit = branch_ref.get().peel_to_commit().map_err(|e| {
        GitError::BranchError(format!(
            "Failed to get commit for remote branch '{remote_name}': {e}"
        ))
    })?;
    Ok(commit.id())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn make_repo() -> (TempDir, Mutex<git2::Repository>) {
        let dir = TempDir::new().unwrap();
        Command::new("git")
            .args(["init"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        std::fs::write(dir.path().join("README.md"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        let repo = git2::Repository::open(dir.path()).unwrap();
        (dir, Mutex::new(repo))
    }

    /// Bug 1: early-return path must propagate an error when the task branch is
    /// missing, not silently return `Ok(WorktreeCreated { base_commit: "" })`.
    #[test]
    fn early_return_fails_when_task_branch_missing() {
        let (dir, repo) = make_repo();
        let worktrees_dir = dir.path().join("worktrees");

        // Create the worktree normally so the registry entry exists.
        execute(&repo, &worktrees_dir, "t1", None).unwrap();

        // Force-delete the task branch ref so the early-return path can't find it.
        // Using git CLI with -D (force) because git2 refuses to delete a branch
        // that is checked out in a linked worktree.
        Command::new("git")
            .args(["update-ref", "-d", "refs/heads/task/t1"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        // Calling execute again should return Err, not Ok with empty base_commit.
        let result = execute(&repo, &worktrees_dir, "t1", None);
        assert!(
            result.is_err(),
            "expected Err when task branch is missing, got Ok"
        );
    }

    /// Bug 2: when `base_branch` doesn't exist anywhere, the error message must
    /// include the branch name and the parent-deleted hint.
    #[test]
    fn missing_base_branch_error_includes_context() {
        let (dir, repo) = make_repo();
        let worktrees_dir = dir.path().join("worktrees");

        let result = execute(&repo, &worktrees_dir, "t2", Some("task/nonexistent-parent"));

        let err = result.expect_err("expected Err for missing base branch");
        let msg = err.to_string();
        assert!(
            msg.contains("task/nonexistent-parent"),
            "error should contain branch name, got: {msg}"
        );
        assert!(
            msg.contains("parent task's branch may have been deleted"),
            "error should include deletion hint, got: {msg}"
        );
    }
}
