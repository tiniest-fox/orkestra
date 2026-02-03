//! Git service port for worktree and branch operations.
//!
//! This port abstracts over git operations, enabling:
//! - Task isolation via git worktrees (one worktree per task)
//! - Branch-based parallel development
//! - Automatic merging when tasks complete
//! - Testability via mock implementations

use serde::Serialize;
use std::fmt;
use std::path::{Path, PathBuf};

/// Errors that can occur during git operations.
#[derive(Debug, Clone)]
pub enum GitError {
    /// Git repository not found or inaccessible.
    RepositoryNotFound(String),
    /// Branch operation failed (create, delete, find).
    BranchError(String),
    /// Worktree operation failed (create, remove, find).
    WorktreeError(String),
    /// Merge operation failed (non-conflict error).
    MergeError(String),
    /// Merge conflict detected.
    MergeConflict {
        branch: String,
        conflict_files: Vec<String>,
    },
    /// I/O error (filesystem operations).
    IoError(String),
}

impl fmt::Display for GitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RepositoryNotFound(msg) => write!(f, "Repository not found: {msg}"),
            Self::BranchError(msg) => write!(f, "Branch error: {msg}"),
            Self::WorktreeError(msg) => write!(f, "Worktree error: {msg}"),
            Self::MergeError(msg) => write!(f, "Merge error: {msg}"),
            Self::MergeConflict {
                branch,
                conflict_files,
            } => {
                write!(
                    f,
                    "Merge conflict on branch {branch}: {} file(s) in conflict",
                    conflict_files.len()
                )
            }
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
        }
    }
}

impl std::error::Error for GitError {}

impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

/// Result of a successful worktree creation.
#[derive(Debug, Clone)]
pub struct WorktreeCreated {
    /// The branch name (e.g., "task/TASK-001").
    pub branch_name: String,
    /// Absolute path to the worktree directory.
    pub worktree_path: PathBuf,
}

/// Result of a successful merge operation.
#[derive(Debug, Clone)]
pub struct MergeResult {
    /// The merge commit SHA.
    pub commit_sha: String,
    /// The target branch that was merged into (e.g., "main").
    pub target_branch: String,
    /// RFC3339 timestamp of when the merge occurred.
    pub merged_at: String,
}

/// Type of change for a file in a diff.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeType {
    /// File was added.
    Added,
    /// File was modified.
    Modified,
    /// File was deleted.
    Deleted,
    /// File was renamed.
    Renamed,
}

/// Diff information for a single file.
#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    /// File path (relative to repo root).
    pub path: String,
    /// Type of change (added, modified, deleted, renamed).
    pub change_type: FileChangeType,
    /// Original path if renamed (None otherwise).
    pub old_path: Option<String>,
    /// Number of lines added.
    pub additions: usize,
    /// Number of lines deleted.
    pub deletions: usize,
    /// Whether the file is binary.
    pub is_binary: bool,
    /// Raw unified diff text (None for binary files).
    pub diff_content: Option<String>,
}

/// Diff information for a task (all changed files).
#[derive(Debug, Clone, Serialize)]
pub struct TaskDiff {
    /// List of file diffs.
    pub files: Vec<FileDiff>,
}

/// Port for git worktree and branch operations.
///
/// This trait abstracts over git operations, allowing:
/// - `Git2GitService`: Production implementation using git2 + CLI
/// - `MockGitService`: Testing implementation with canned responses
///
/// The trait requires `Send + Sync` for thread-safe sharing across
/// the orchestrator and Tauri command handlers.
pub trait GitService: Send + Sync {
    /// Create a worktree for a task.
    ///
    /// Creates branch `task/{task_id}` from `base_branch` (or current HEAD if None)
    /// and a worktree at `.orkestra/worktrees/{task_id}`.
    ///
    /// If `.orkestra/worktree_setup.sh` exists, it will be executed with the
    /// worktree path as an argument (for project-specific setup like copying .env).
    fn create_worktree(
        &self,
        task_id: &str,
        base_branch: Option<&str>,
    ) -> Result<WorktreeCreated, GitError>;

    /// Check if a worktree exists for the given task ID.
    fn worktree_exists(&self, task_id: &str) -> bool;

    /// Remove a worktree and optionally its branch.
    ///
    /// - `delete_branch=true`: Delete both worktree and branch (task abandoned)
    /// - `delete_branch=false`: Delete worktree only, keep branch (task merged)
    fn remove_worktree(&self, task_id: &str, delete_branch: bool) -> Result<(), GitError>;

    /// List local branches, excluding task/* worktree branches.
    fn list_branches(&self) -> Result<Vec<String>, GitError>;

    /// Get the currently checked-out branch name.
    ///
    /// Returns "HEAD" if in detached HEAD state.
    fn current_branch(&self) -> Result<String, GitError>;

    /// Commit any uncommitted changes in a worktree.
    ///
    /// Stages all changes with `git add -A` and commits with the given message.
    /// No-op if there are no changes to commit.
    fn commit_pending_changes(&self, worktree_path: &Path, message: &str) -> Result<(), GitError>;

    /// Merge a task branch into a specific target branch.
    ///
    /// Stashes uncommitted changes in main repo, performs merge, restores stash.
    /// Returns merge result on success, or `GitError::MergeConflict` if conflicts occur.
    fn merge_to_branch(
        &self,
        branch_name: &str,
        target_branch: &str,
    ) -> Result<MergeResult, GitError>;

    /// Get list of files currently in merge conflict.
    fn get_conflict_files(&self) -> Result<Vec<String>, GitError>;

    /// Abort a merge in progress.
    fn abort_merge(&self) -> Result<(), GitError>;

    /// Rebase the current branch in a worktree onto a specific target branch.
    ///
    /// Runs in the worktree directory so the main repo checkout is never touched.
    /// If conflicts occur, the rebase is aborted and `GitError::MergeConflict`
    /// is returned.
    fn rebase_on_branch(&self, worktree_path: &Path, target_branch: &str) -> Result<(), GitError>;

    /// Delete a branch (force delete with -D).
    fn delete_branch(&self, branch_name: &str) -> Result<(), GitError>;

    /// List worktree directory names (task IDs) under the worktrees directory.
    ///
    /// Returns just the directory names (not full paths), which correspond to task IDs.
    /// Returns an empty vec if the worktrees directory doesn't exist.
    fn list_worktree_names(&self) -> Result<Vec<String>, GitError>;

    /// Check if a branch is fully merged into a target branch.
    ///
    /// Returns `true` if all commits on `branch_name` are reachable from
    /// `target_branch` (i.e., merging would be a no-op).
    ///
    /// Also returns `true` if the branch does not exist — a missing branch
    /// means it was already cleaned up after a successful merge.
    fn is_branch_merged(&self, branch_name: &str, target_branch: &str) -> Result<bool, GitError>;

    /// Compute diff between a branch and its base branch.
    ///
    /// Returns the diff from the merge-base of the two branches to the
    /// current HEAD of the branch. This shows only changes made on the
    /// branch, not changes that happened on the base branch after branching.
    fn diff_against_base(
        &self,
        worktree_path: &Path,
        branch_name: &str,
        base_branch: &str,
    ) -> Result<TaskDiff, GitError>;

    /// Read file content at HEAD of the current branch.
    ///
    /// Returns `None` if the file doesn't exist at HEAD.
    fn read_file_at_head(
        &self,
        worktree_path: &Path,
        file_path: &str,
    ) -> Result<Option<String>, GitError>;
}

// =============================================================================
// Mock Implementation for Testing
// =============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::{GitError, GitService, MergeResult, Path, PathBuf, WorktreeCreated};
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// Mock git service for testing.
    ///
    /// Tracks worktrees in memory and allows setting expected merge results.
    pub struct MockGitService {
        worktrees: Mutex<HashMap<String, PathBuf>>,
        branches: Mutex<Vec<String>>,
        current_branch: Mutex<String>,
        next_merge_result: Mutex<Option<Result<MergeResult, GitError>>>,
        next_rebase_result: Mutex<Option<Result<(), GitError>>>,
        create_worktree_calls: Mutex<Vec<(String, Option<String>)>>,
        remove_worktree_calls: Mutex<Vec<(String, bool)>>,
        merged_branches: Mutex<HashMap<String, bool>>,
    }

    impl MockGitService {
        /// Create a new mock git service.
        pub fn new() -> Self {
            Self {
                worktrees: Mutex::new(HashMap::new()),
                branches: Mutex::new(vec!["main".to_string()]),
                current_branch: Mutex::new("main".to_string()),
                next_merge_result: Mutex::new(None),
                next_rebase_result: Mutex::new(None),
                create_worktree_calls: Mutex::new(Vec::new()),
                remove_worktree_calls: Mutex::new(Vec::new()),
                merged_branches: Mutex::new(HashMap::new()),
            }
        }

        /// Set the result for the next merge operation.
        pub fn set_next_merge_result(&self, result: Result<MergeResult, GitError>) {
            *self.next_merge_result.lock().unwrap() = Some(result);
        }

        /// Set the result for the next rebase operation.
        pub fn set_next_rebase_result(&self, result: Result<(), GitError>) {
            *self.next_rebase_result.lock().unwrap() = Some(result);
        }

        /// Add a branch to the list of available branches.
        pub fn add_branch(&self, name: &str) {
            self.branches.lock().unwrap().push(name.to_string());
        }

        /// Set the current branch.
        pub fn set_current_branch(&self, name: &str) {
            *self.current_branch.lock().unwrap() = name.to_string();
        }

        /// Get the list of `create_worktree` calls for verification.
        pub fn get_create_worktree_calls(&self) -> Vec<(String, Option<String>)> {
            self.create_worktree_calls.lock().unwrap().clone()
        }

        /// Get the list of `remove_worktree` calls for verification.
        pub fn get_remove_worktree_calls(&self) -> Vec<(String, bool)> {
            self.remove_worktree_calls.lock().unwrap().clone()
        }

        /// Mark a branch as merged (or not) for `is_branch_merged` checks.
        pub fn set_branch_merged(&self, branch_name: &str, merged: bool) {
            self.merged_branches
                .lock()
                .unwrap()
                .insert(branch_name.to_string(), merged);
        }
    }

    impl Default for MockGitService {
        fn default() -> Self {
            Self::new()
        }
    }

    impl GitService for MockGitService {
        fn create_worktree(
            &self,
            task_id: &str,
            base_branch: Option<&str>,
        ) -> Result<WorktreeCreated, GitError> {
            self.create_worktree_calls
                .lock()
                .unwrap()
                .push((task_id.to_string(), base_branch.map(String::from)));

            let branch_name = format!("task/{task_id}");
            let worktree_path = PathBuf::from(format!(".orkestra/worktrees/{task_id}"));

            self.worktrees
                .lock()
                .unwrap()
                .insert(task_id.to_string(), worktree_path.clone());

            Ok(WorktreeCreated {
                branch_name,
                worktree_path,
            })
        }

        fn worktree_exists(&self, task_id: &str) -> bool {
            self.worktrees.lock().unwrap().contains_key(task_id)
        }

        fn remove_worktree(&self, task_id: &str, delete_branch: bool) -> Result<(), GitError> {
            self.remove_worktree_calls
                .lock()
                .unwrap()
                .push((task_id.to_string(), delete_branch));

            self.worktrees.lock().unwrap().remove(task_id);
            Ok(())
        }

        fn list_branches(&self) -> Result<Vec<String>, GitError> {
            Ok(self.branches.lock().unwrap().clone())
        }

        fn current_branch(&self) -> Result<String, GitError> {
            Ok(self.current_branch.lock().unwrap().clone())
        }

        fn commit_pending_changes(
            &self,
            _worktree_path: &Path,
            _message: &str,
        ) -> Result<(), GitError> {
            // Mock: always succeeds
            Ok(())
        }

        fn merge_to_branch(
            &self,
            branch_name: &str,
            target_branch: &str,
        ) -> Result<MergeResult, GitError> {
            if let Some(result) = self.next_merge_result.lock().unwrap().take() {
                return result;
            }

            Ok(MergeResult {
                commit_sha: format!("mock-sha-{}", branch_name.replace('/', "-")),
                target_branch: target_branch.to_string(),
                merged_at: chrono::Utc::now().to_rfc3339(),
            })
        }

        fn rebase_on_branch(
            &self,
            _worktree_path: &Path,
            _target_branch: &str,
        ) -> Result<(), GitError> {
            if let Some(result) = self.next_rebase_result.lock().unwrap().take() {
                return result;
            }
            Ok(())
        }

        fn get_conflict_files(&self) -> Result<Vec<String>, GitError> {
            Ok(vec![])
        }

        fn abort_merge(&self) -> Result<(), GitError> {
            Ok(())
        }

        fn delete_branch(&self, _branch_name: &str) -> Result<(), GitError> {
            Ok(())
        }

        fn list_worktree_names(&self) -> Result<Vec<String>, GitError> {
            Ok(self.worktrees.lock().unwrap().keys().cloned().collect())
        }

        fn is_branch_merged(
            &self,
            branch_name: &str,
            _target_branch: &str,
        ) -> Result<bool, GitError> {
            if let Some(&merged) = self.merged_branches.lock().unwrap().get(branch_name) {
                return Ok(merged);
            }
            // Default: not merged (conservative)
            Ok(false)
        }

        fn diff_against_base(
            &self,
            _worktree_path: &Path,
            _branch_name: &str,
            _base_branch: &str,
        ) -> Result<super::TaskDiff, GitError> {
            Ok(super::TaskDiff { files: vec![] })
        }

        fn read_file_at_head(
            &self,
            _worktree_path: &Path,
            _file_path: &str,
        ) -> Result<Option<String>, GitError> {
            Ok(None)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_mock_create_worktree() {
            let mock = MockGitService::new();
            let result = mock.create_worktree("TASK-001", Some("main")).unwrap();

            assert_eq!(result.branch_name, "task/TASK-001");
            assert!(result.worktree_path.to_string_lossy().contains("TASK-001"));
            assert!(mock.worktree_exists("TASK-001"));

            let calls = mock.get_create_worktree_calls();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].0, "TASK-001");
            assert_eq!(calls[0].1, Some("main".to_string()));
        }

        #[test]
        fn test_mock_remove_worktree() {
            let mock = MockGitService::new();
            mock.create_worktree("TASK-001", None).unwrap();
            assert!(mock.worktree_exists("TASK-001"));

            mock.remove_worktree("TASK-001", true).unwrap();
            assert!(!mock.worktree_exists("TASK-001"));

            let calls = mock.get_remove_worktree_calls();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0], ("TASK-001".to_string(), true));
        }

        #[test]
        fn test_mock_merge_result() {
            let mock = MockGitService::new();

            // Test default success
            let result = mock.merge_to_branch("task/TASK-001", "main").unwrap();
            assert!(result.commit_sha.starts_with("mock-sha"));

            // Test configured conflict
            mock.set_next_merge_result(Err(GitError::MergeConflict {
                branch: "task/TASK-002".to_string(),
                conflict_files: vec!["file.rs".to_string()],
            }));

            let err = mock.merge_to_branch("task/TASK-002", "main").unwrap_err();
            assert!(matches!(err, GitError::MergeConflict { .. }));
        }
    }
}
