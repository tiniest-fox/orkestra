//! Git service port for worktree and branch operations.
//!
//! This port abstracts over git operations, enabling:
//! - Task isolation via git worktrees (one worktree per task)
//! - Branch-based parallel development
//! - Automatic merging when tasks complete
//! - Testability via mock implementations

use serde::Serialize;
use std::collections::HashMap;
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
    /// Other git operation error.
    Other(String),
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
            Self::Other(msg) => write!(f, "Git error: {msg}"),
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
    /// Git commit SHA of the base branch at worktree creation time.
    pub base_commit: String,
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

/// Type of change made to a file in a diff.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
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
    /// Path to the file (new path if renamed).
    pub path: String,
    /// Type of change.
    pub change_type: FileChangeType,
    /// Original path (only for renames).
    pub old_path: Option<String>,
    /// Number of lines added.
    pub additions: usize,
    /// Number of lines deleted.
    pub deletions: usize,
    /// Whether the file is binary.
    pub is_binary: bool,
    /// Raw unified diff content (None for binary files).
    pub diff_content: Option<String>,
}

/// Complete diff for a task branch against its base.
#[derive(Debug, Clone, Serialize)]
pub struct TaskDiff {
    /// List of changed files with their diffs.
    pub files: Vec<FileDiff>,
}

/// Metadata for a single git commit.
#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    /// Short commit hash (7 chars).
    pub hash: String,
    /// First line of the commit message.
    pub message: String,
    /// Lines after the subject line, if any.
    pub body: Option<String>,
    /// Author name.
    pub author: String,
    /// ISO 8601 timestamp.
    pub timestamp: String,
    /// Number of files changed in this commit.
    pub file_count: Option<usize>,
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

    /// List local branches, excluding task/* worktree branches.
    fn list_branches(&self) -> Result<Vec<String>, GitError>;

    /// Get the currently checked-out branch name.
    ///
    /// Returns "HEAD" if in detached HEAD state.
    fn current_branch(&self) -> Result<String, GitError>;

    /// Check whether a worktree has uncommitted changes (staged or unstaged).
    fn has_pending_changes(&self, worktree_path: &Path) -> Result<bool, GitError>;

    /// Commit any uncommitted changes in a worktree.
    ///
    /// Stages all changes with `git add -A` and commits with the given message.
    /// No-op if there are no changes to commit.
    fn commit_pending_changes(&self, worktree_path: &Path, message: &str) -> Result<(), GitError>;

    /// Merge a task branch into a specific target branch.
    ///
    /// Operates in the target branch's working directory (worktree for `task/*`
    /// branches, main repo otherwise). Stashes uncommitted changes, performs an
    /// `--ff-only` merge, then restores the stash.
    fn merge_to_branch(
        &self,
        branch_name: &str,
        target_branch: &str,
    ) -> Result<MergeResult, GitError>;

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

    /// Get the diff between a task branch and its base branch.
    ///
    /// Computes the diff from the merge-base of `base_branch` and `branch_name`
    /// to the HEAD of `branch_name`, showing only changes made on the task branch.
    ///
    /// Returns structured diff data including file paths, change types, and
    /// unified diff content for each file.
    fn diff_against_base(
        &self,
        worktree_path: &Path,
        branch_name: &str,
        base_branch: &str,
    ) -> Result<TaskDiff, GitError>;

    /// Get the diff of uncommitted changes in a worktree.
    ///
    /// Computes staged + unstaged changes relative to HEAD, plus untracked files.
    /// Used for commit message generation (as opposed to `diff_against_base` which
    /// shows all branch changes for review context).
    fn diff_uncommitted(&self, worktree_path: &Path) -> Result<TaskDiff, GitError>;

    /// Read the content of a file at HEAD in a worktree.
    ///
    /// Returns the file content as a string, or None if the file doesn't exist.
    fn read_file_at_head(
        &self,
        worktree_path: &Path,
        file_path: &str,
    ) -> Result<Option<String>, GitError>;

    /// Get the N most recent commits on the current branch.
    ///
    /// Returns commit metadata without file counts. Use `batch_file_counts`
    /// to fetch file change counts separately.
    fn commit_log(&self, limit: usize) -> Result<Vec<CommitInfo>, GitError>;

    /// Get file change counts for a batch of commit hashes.
    ///
    /// Returns a map from commit hash to the number of files changed.
    /// Hashes that can't be resolved are silently omitted.
    fn batch_file_counts(&self, hashes: &[String]) -> Result<HashMap<String, usize>, GitError>;

    /// Get the diff for a specific commit.
    ///
    /// Returns the same `TaskDiff` format as `diff_against_base`,
    /// showing all changes introduced by the given commit.
    fn commit_diff(&self, commit_hash: &str) -> Result<TaskDiff, GitError>;

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
    /// Returns `Err(GitError::Other)` if:
    /// - No remote named "origin" is configured
    /// - Network/authentication error during fetch
    /// - Branch has diverged (local has commits not on remote)
    fn sync_base_branch(&self, branch: &str) -> Result<(), GitError>;

    /// Squash all commits since merge-base into a single commit.
    ///
    /// Finds the merge-base of the current branch and `target_branch`, then:
    /// 1. Performs `git reset --soft {merge-base}` to unstage commits
    /// 2. Creates a new commit with the provided `message`
    ///
    /// This operation is performed in the worktree directory and does not
    /// affect the main repository's working directory.
    ///
    /// # Returns
    ///
    /// Returns `Ok(true)` if commits were squashed, `Ok(false)` if there were
    /// no commits to squash (branch is at merge-base already).
    fn squash_commits(
        &self,
        worktree_path: &Path,
        target_branch: &str,
        message: &str,
    ) -> Result<bool, GitError>;
}

// =============================================================================
// Mock Implementation for Testing
// =============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::{GitError, GitService, MergeResult, Path, PathBuf, TaskDiff, WorktreeCreated};
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
        next_squash_result: Mutex<Option<Result<bool, GitError>>>,
        push_results: Mutex<std::collections::VecDeque<Result<(), GitError>>>,
        sync_results: Mutex<std::collections::VecDeque<Result<(), GitError>>>,
        create_worktree_calls: Mutex<Vec<(String, Option<String>)>>,
        remove_worktree_calls: Mutex<Vec<(String, bool)>>,
        squash_calls: Mutex<Vec<(PathBuf, String, String)>>,
        sync_base_branch_calls: Mutex<Vec<String>>,
        push_branch_calls: Mutex<Vec<String>>,
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
                next_squash_result: Mutex::new(None),
                push_results: Mutex::new(std::collections::VecDeque::new()),
                sync_results: Mutex::new(std::collections::VecDeque::new()),
                create_worktree_calls: Mutex::new(Vec::new()),
                remove_worktree_calls: Mutex::new(Vec::new()),
                squash_calls: Mutex::new(Vec::new()),
                sync_base_branch_calls: Mutex::new(Vec::new()),
                push_branch_calls: Mutex::new(Vec::new()),
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

        /// Set the result for the next push operation.
        pub fn set_next_push_result(&self, result: Result<(), GitError>) {
            self.push_results.lock().unwrap().push_back(result);
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

        /// Set the result for the next squash operation.
        pub fn set_next_squash_result(&self, result: Result<bool, GitError>) {
            *self.next_squash_result.lock().unwrap() = Some(result);
        }

        /// Get the list of `squash_commits` calls for verification.
        pub fn get_squash_calls(&self) -> Vec<(PathBuf, String, String)> {
            self.squash_calls.lock().unwrap().clone()
        }

        /// Set the result for the next `sync_base_branch` operation.
        pub fn set_next_sync_result(&self, result: Result<(), GitError>) {
            self.sync_results.lock().unwrap().push_back(result);
        }

        /// Get the list of `sync_base_branch` calls for verification.
        pub fn get_sync_base_branch_calls(&self) -> Vec<String> {
            self.sync_base_branch_calls.lock().unwrap().clone()
        }

        /// Get the list of `push_branch` calls for verification.
        pub fn get_push_branch_calls(&self) -> Vec<String> {
            self.push_branch_calls.lock().unwrap().clone()
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
            let worktree_path = PathBuf::from(format!(".orkestra/.worktrees/{task_id}"));

            self.worktrees
                .lock()
                .unwrap()
                .insert(task_id.to_string(), worktree_path.clone());

            Ok(WorktreeCreated {
                branch_name,
                worktree_path,
                base_commit: "mock-base-commit-sha".to_string(),
            })
        }

        fn ensure_worktree(
            &self,
            task_id: &str,
            base_branch: Option<&str>,
        ) -> Result<WorktreeCreated, GitError> {
            // If worktree already exists, return its info without recording a new call
            if self.worktree_exists(task_id) {
                let branch_name = format!("task/{task_id}");
                let worktree_path = PathBuf::from(format!(".orkestra/.worktrees/{task_id}"));
                return Ok(WorktreeCreated {
                    branch_name,
                    worktree_path,
                    base_commit: "mock-base-commit-sha".to_string(),
                });
            }

            // Otherwise, create it (this records the call)
            self.create_worktree(task_id, base_branch)
        }

        fn run_setup_script(&self, _worktree_path: &Path) -> Result<(), GitError> {
            // Mock: always succeeds
            Ok(())
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

        fn has_pending_changes(&self, _worktree_path: &Path) -> Result<bool, GitError> {
            // Mock: no pending changes
            Ok(false)
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
        ) -> Result<TaskDiff, GitError> {
            // Mock: return empty diff
            Ok(TaskDiff { files: vec![] })
        }

        fn diff_uncommitted(&self, _worktree_path: &Path) -> Result<TaskDiff, GitError> {
            // Mock: return empty diff (consistent with diff_against_base mock)
            Ok(TaskDiff { files: vec![] })
        }

        fn read_file_at_head(
            &self,
            _worktree_path: &Path,
            _file_path: &str,
        ) -> Result<Option<String>, GitError> {
            // Mock: file doesn't exist
            Ok(None)
        }

        fn commit_log(&self, _limit: usize) -> Result<Vec<super::CommitInfo>, GitError> {
            Ok(vec![])
        }

        fn batch_file_counts(
            &self,
            _hashes: &[String],
        ) -> Result<HashMap<String, usize>, GitError> {
            Ok(HashMap::new())
        }

        fn commit_diff(&self, _commit_hash: &str) -> Result<TaskDiff, GitError> {
            Ok(TaskDiff { files: vec![] })
        }

        fn push_branch(&self, branch: &str) -> Result<(), GitError> {
            self.push_branch_calls
                .lock()
                .unwrap()
                .push(branch.to_string());
            self.push_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(()))
        }

        fn sync_base_branch(&self, branch: &str) -> Result<(), GitError> {
            self.sync_base_branch_calls
                .lock()
                .unwrap()
                .push(branch.to_string());
            self.sync_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(()))
        }

        fn squash_commits(
            &self,
            worktree_path: &Path,
            target_branch: &str,
            message: &str,
        ) -> Result<bool, GitError> {
            self.squash_calls.lock().unwrap().push((
                worktree_path.to_path_buf(),
                target_branch.to_string(),
                message.to_string(),
            ));

            if let Some(result) = self.next_squash_result.lock().unwrap().take() {
                return result;
            }

            // Default: assume squash succeeded with commits to squash
            Ok(true)
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

        #[test]
        fn test_mock_squash_commits_default() {
            let mock = MockGitService::new();
            let worktree_path = PathBuf::from("/test/worktree");

            // Default: returns Ok(true)
            let result = mock
                .squash_commits(&worktree_path, "main", "Squash message")
                .unwrap();
            assert!(result, "Default should return true");

            // Verify call was recorded
            let calls = mock.get_squash_calls();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].0, worktree_path);
            assert_eq!(calls[0].1, "main");
            assert_eq!(calls[0].2, "Squash message");
        }

        #[test]
        fn test_mock_squash_commits_configured() {
            let mock = MockGitService::new();
            let worktree_path = PathBuf::from("/test/worktree");

            // Configure to return false (no commits to squash)
            mock.set_next_squash_result(Ok(false));
            let result = mock.squash_commits(&worktree_path, "main", "msg").unwrap();
            assert!(!result, "Should return false when configured");

            // Configure an error
            mock.set_next_squash_result(Err(GitError::Other("squash failed".into())));
            let err = mock
                .squash_commits(&worktree_path, "main", "msg")
                .unwrap_err();
            assert!(matches!(err, GitError::Other(_)));
        }
    }
}
