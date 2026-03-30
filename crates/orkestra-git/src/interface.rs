//! Git service trait definition.
//!
//! The contract that callers depend on. Implementations live in the service layer.

use std::collections::HashMap;
use std::path::Path;

use crate::types::{
    CommitInfo, GitError, MergeResult, SyncStatus, TaskDiff, WorktreeCreated, WorktreeState,
};

/// Port for git worktree and branch operations.
///
/// This trait abstracts over git operations, allowing:
/// - `Git2GitService`: Production implementation using git2 + CLI
/// - `MockGitService`: Testing implementation with canned responses
///
/// The trait requires `Send + Sync` for thread-safe sharing across
/// the orchestrator and Tauri command handlers.
pub trait GitService: Send + Sync {
    // -- Worktree --

    /// Create a worktree for a task.
    ///
    /// Creates branch `task/{task_id}` from `base_branch` (or current HEAD if None)
    /// and a worktree at `.orkestra/.worktrees/{task_id}`.
    ///
    /// If `.orkestra/scripts/worktree_setup.sh` exists, it will be executed with the
    /// worktree path as an argument (for project-specific setup like copying .env).
    fn create_worktree(
        &self,
        task_id: &str,
        base_branch: Option<&str>,
    ) -> Result<WorktreeCreated, GitError>;

    /// Create worktree if it doesn't exist, or return existing info.
    ///
    /// Unlike `create_worktree`, this does NOT run the setup script - the caller
    /// handles that separately via `run_setup_script`. This split allows saving
    /// worktree info to the database before the setup script runs, enabling retry
    /// if the setup script fails.
    fn ensure_worktree(
        &self,
        task_id: &str,
        base_branch: Option<&str>,
    ) -> Result<WorktreeCreated, GitError>;

    /// Run the worktree setup script.
    ///
    /// Executes `.orkestra/scripts/worktree_setup.sh` with the worktree path as an argument.
    /// Returns `Ok(())` if the script doesn't exist or succeeds.
    fn run_setup_script(&self, worktree_path: &Path) -> Result<(), GitError>;

    /// Check if a worktree exists for the given task ID.
    fn worktree_exists(&self, task_id: &str) -> bool;

    /// Remove a worktree and optionally its branch.
    ///
    /// - `delete_branch=true`: Delete both worktree and branch (task abandoned)
    /// - `delete_branch=false`: Delete worktree only, keep branch (task merged)
    fn remove_worktree(&self, task_id: &str, delete_branch: bool) -> Result<(), GitError>;

    /// List worktree directory names (task IDs) under the worktrees directory.
    ///
    /// Returns just the directory names (not full paths), which correspond to task IDs.
    /// Returns an empty vec if the worktrees directory doesn't exist.
    fn list_worktree_names(&self) -> Result<Vec<String>, GitError>;

    /// Get the HEAD SHA and dirty status for a worktree.
    ///
    /// Uses git2 directly (no subprocess), so this is cheap (~1ms). Call this before
    /// `diff_against_base` to check whether an existing cached diff is still valid.
    fn get_worktree_state(&self, worktree_path: &Path) -> Result<WorktreeState, GitError>;

    // -- Branch --

    /// List local branches, excluding task/* worktree branches.
    fn list_branches(&self) -> Result<Vec<String>, GitError>;

    /// Get the currently checked-out branch name.
    ///
    /// Returns "HEAD" if in detached HEAD state.
    fn current_branch(&self) -> Result<String, GitError>;

    /// Delete a branch (force delete with -D).
    fn delete_branch(&self, branch_name: &str) -> Result<(), GitError>;

    /// Check if a branch is fully merged into a target branch.
    ///
    /// Returns `true` if all commits on `branch_name` are reachable from
    /// `target_branch` (i.e., merging would be a no-op).
    ///
    /// Also returns `true` if the branch does not exist — a missing branch
    /// means it was already cleaned up after a successful merge.
    fn is_branch_merged(&self, branch_name: &str, target_branch: &str) -> Result<bool, GitError>;

    // -- Commit --

    /// Check whether a worktree has uncommitted changes (staged or unstaged).
    fn has_pending_changes(&self, worktree_path: &Path) -> Result<bool, GitError>;

    /// Commit any uncommitted changes in a worktree.
    ///
    /// Stages all changes with `git add -A` and commits with the given message.
    /// No-op if there are no changes to commit.
    fn commit_pending_changes(&self, worktree_path: &Path, message: &str) -> Result<(), GitError>;

    /// Get the N most recent commits on the current branch.
    ///
    /// Returns commit metadata without file counts. Use `batch_file_counts`
    /// to fetch file change counts separately.
    fn commit_log(&self, limit: usize) -> Result<Vec<CommitInfo>, GitError>;

    /// Get the N most recent commits from a specific worktree/path.
    ///
    /// Like `commit_log` but operates on the branch checked out at `path`
    /// instead of the main repository HEAD.
    fn commit_log_at(&self, path: &Path, limit: usize) -> Result<Vec<CommitInfo>, GitError>;

    /// Get file change counts for a batch of commit hashes.
    ///
    /// Returns a map from commit hash to the number of files changed.
    /// Hashes that can't be resolved are silently omitted.
    fn batch_file_counts(&self, hashes: &[String]) -> Result<HashMap<String, usize>, GitError>;

    /// Read the content of a file at HEAD in a worktree.
    ///
    /// Returns the file content as a string, or None if the file doesn't exist.
    fn read_file_at_head(
        &self,
        worktree_path: &Path,
        file_path: &str,
    ) -> Result<Option<String>, GitError>;

    // -- Diff --

    /// Get the diff between a task branch and its base branch.
    ///
    /// Computes the diff from the merge-base of `base_branch` and `branch_name`
    /// to the HEAD of `branch_name`, showing only changes made on the task branch.
    ///
    /// Returns structured diff data including file paths, change types, and
    /// unified diff content for each file. `context_lines` controls how many
    /// surrounding context lines are included in each hunk (default: 3).
    fn diff_against_base(
        &self,
        worktree_path: &Path,
        branch_name: &str,
        base_branch: &str,
        context_lines: u32,
    ) -> Result<TaskDiff, GitError>;

    /// Get the diff of uncommitted changes in a worktree.
    ///
    /// Computes staged + unstaged changes relative to HEAD, plus untracked files.
    /// Used for commit message generation (as opposed to `diff_against_base` which
    /// shows all branch changes for review context).
    fn diff_uncommitted(&self, worktree_path: &Path) -> Result<TaskDiff, GitError>;

    /// Get the diff for a specific commit.
    ///
    /// Returns the same `TaskDiff` format as `diff_against_base`,
    /// showing all changes introduced by the given commit. `context_lines`
    /// controls how many surrounding context lines are included (default: 3).
    fn commit_diff(&self, commit_hash: &str, context_lines: u32) -> Result<TaskDiff, GitError>;

    // -- Merge --

    /// Merge a task branch into a specific target branch.
    ///
    /// Operates in the target branch's working directory (worktree for `task/*`
    /// branches, main repo otherwise). Stashes uncommitted changes, performs the
    /// merge, then restores the stash.
    ///
    /// When `message` is `Some`, uses `--no-ff -m <message>` to create an explicit
    /// merge commit with that message. When `None`, uses `--ff-only`.
    fn merge_to_branch(
        &self,
        branch_name: &str,
        target_branch: &str,
        message: Option<&str>,
    ) -> Result<MergeResult, GitError>;

    /// Merge a target branch into the current branch in a worktree.
    ///
    /// Uses `--no-ff` to always produce a merge commit. On conflict, returns
    /// `GitError::MergeConflict` without aborting, so conflict markers remain
    /// in the working tree for agent resolution.
    fn merge_into_worktree(
        &self,
        worktree_path: &Path,
        target_branch: &str,
    ) -> Result<(), GitError>;

    /// Rebase the current branch in a worktree onto a specific target branch.
    ///
    /// Runs in the worktree directory so the main repo checkout is never touched.
    /// If conflicts occur, the rebase is aborted and `GitError::MergeConflict`
    /// is returned.
    fn rebase_on_branch(&self, worktree_path: &Path, target_branch: &str) -> Result<(), GitError>;

    /// Squash all commits since merge-base into a single commit.
    ///
    /// Finds the merge-base of the current branch and `target_branch`, then:
    /// 1. Performs `git reset --soft {merge-base}` to unstage commits
    /// 2. Creates a new commit with the provided `message`
    ///
    /// Returns `Ok(true)` if commits were squashed, `Ok(false)` if there were
    /// no commits to squash (branch is at merge-base already).
    fn squash_commits(
        &self,
        worktree_path: &Path,
        target_branch: &str,
        message: &str,
    ) -> Result<bool, GitError>;

    // -- Remote --

    /// Push a branch to the remote.
    ///
    /// Uses the default remote (typically "origin"). Fails if no remote is configured
    /// or if the push is rejected.
    fn push_branch(&self, branch: &str) -> Result<(), GitError>;

    /// Sync a local branch with its remote tracking branch.
    ///
    /// Fetches from origin and fast-forwards the local branch to match.
    /// Uses `git fetch origin branch:branch` for atomic update without checkout.
    ///
    /// Returns `Ok(())` on success or if already up-to-date.
    fn sync_base_branch(&self, branch: &str) -> Result<(), GitError>;

    /// Get sync status relative to origin for the current branch.
    ///
    /// Returns `Ok(None)` if:
    /// - No remote named "origin" is configured
    /// - The branch doesn't exist on origin
    /// - In detached HEAD state
    fn sync_status(&self) -> Result<Option<SyncStatus>, GitError>;

    /// Pull changes from origin into the current branch using rebase.
    ///
    /// Performs `git pull --rebase origin {branch}`. If the rebase encounters
    /// conflicts, it is aborted to restore a clean working tree and
    /// `GitError::MergeConflict` is returned.
    fn pull_branch(&self) -> Result<(), GitError>;

    /// Pull changes from origin into the branch checked out in a specific worktree using rebase.
    ///
    /// Like `pull_branch` but targets a worktree directory rather than the main repo.
    /// Use this when pulling a task branch that lives in `.orkestra/.worktrees/{task-id}`.
    fn pull_branch_in(&self, worktree_path: &Path) -> Result<(), GitError>;

    /// Fetch from origin to update remote-tracking refs without merging.
    fn fetch_origin(&self) -> Result<(), GitError>;

    /// Force-push a branch to origin using --force-with-lease.
    fn force_push_branch(&self, branch: &str) -> Result<(), GitError>;

    /// Get sync status for a specific branch (without detecting current branch).
    ///
    /// Useful for checking task branches from the main repo.
    /// Returns `Ok(None)` if the branch doesn't exist on origin.
    fn sync_status_for_branch(&self, branch: &str) -> Result<Option<SyncStatus>, GitError>;
}
