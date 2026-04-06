//! Mock git service for testing.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::interface::GitService;
use crate::types::{
    CommitInfo, GitError, MergeResult, SyncStatus, TaskDiff, WorktreeCreated, WorktreeState,
};

/// Mock git service for testing.
///
/// Tracks worktrees in memory and allows setting expected merge results.
pub struct MockGitService {
    worktrees: Mutex<HashMap<String, PathBuf>>,
    branches: Mutex<Vec<String>>,
    current_branch: Mutex<String>,
    next_merge_result: Mutex<Option<Result<MergeResult, GitError>>>,
    next_rebase_result: Mutex<Option<Result<(), GitError>>>,
    next_merge_into_worktree_result: Mutex<Option<Result<(), GitError>>>,
    next_squash_result: Mutex<Option<Result<bool, GitError>>>,
    push_results: Mutex<std::collections::VecDeque<Result<(), GitError>>>,
    sync_results: Mutex<std::collections::VecDeque<Result<(), GitError>>>,
    create_worktree_calls: Mutex<Vec<(String, Option<String>)>>,
    remove_worktree_calls: Mutex<Vec<(String, bool)>>,
    merge_to_branch_calls: Mutex<Vec<(String, String, Option<String>)>>,
    squash_calls: Mutex<Vec<(PathBuf, String, String)>>,
    sync_base_branch_calls: Mutex<Vec<String>>,
    push_branch_calls: Mutex<Vec<String>>,
    merged_branches: Mutex<HashMap<String, bool>>,
    sync_status: Mutex<Option<SyncStatus>>,
    pull_results: Mutex<std::collections::VecDeque<Result<(), GitError>>>,
    pull_branch_in_calls: Mutex<Vec<PathBuf>>,
    pull_branch_in_results: Mutex<std::collections::VecDeque<Result<(), GitError>>>,
    has_pending_changes: Mutex<bool>,
    commit_pending_changes_calls: Mutex<Vec<(PathBuf, String)>>,
    force_push_calls: Mutex<Vec<String>>,
    force_push_error: Mutex<Option<GitError>>,
    branch_commits_results: Mutex<std::collections::VecDeque<Result<Vec<CommitInfo>, GitError>>>,
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
            next_merge_into_worktree_result: Mutex::new(None),
            next_squash_result: Mutex::new(None),
            push_results: Mutex::new(std::collections::VecDeque::new()),
            sync_results: Mutex::new(std::collections::VecDeque::new()),
            create_worktree_calls: Mutex::new(Vec::new()),
            remove_worktree_calls: Mutex::new(Vec::new()),
            merge_to_branch_calls: Mutex::new(Vec::new()),
            squash_calls: Mutex::new(Vec::new()),
            sync_base_branch_calls: Mutex::new(Vec::new()),
            push_branch_calls: Mutex::new(Vec::new()),
            merged_branches: Mutex::new(HashMap::new()),
            sync_status: Mutex::new(None),
            pull_results: Mutex::new(std::collections::VecDeque::new()),
            pull_branch_in_calls: Mutex::new(Vec::new()),
            pull_branch_in_results: Mutex::new(std::collections::VecDeque::new()),
            has_pending_changes: Mutex::new(false),
            commit_pending_changes_calls: Mutex::new(Vec::new()),
            force_push_calls: Mutex::new(Vec::new()),
            force_push_error: Mutex::new(None),
            branch_commits_results: Mutex::new(std::collections::VecDeque::new()),
        }
    }

    /// Configure whether `has_pending_changes` returns `true` or `false`.
    pub fn set_has_pending_changes(&self, value: bool) {
        *self.has_pending_changes.lock().unwrap() = value;
    }

    /// Set the result for the next merge operation.
    pub fn set_next_merge_result(&self, result: Result<MergeResult, GitError>) {
        *self.next_merge_result.lock().unwrap() = Some(result);
    }

    /// Set the result for the next rebase operation.
    pub fn set_next_rebase_result(&self, result: Result<(), GitError>) {
        *self.next_rebase_result.lock().unwrap() = Some(result);
    }

    /// Set the result for the next `merge_into_worktree` operation.
    pub fn set_next_merge_into_worktree_result(&self, result: Result<(), GitError>) {
        *self.next_merge_into_worktree_result.lock().unwrap() = Some(result);
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

    /// Get the list of `merge_to_branch` calls for verification.
    ///
    /// Each entry is `(branch_name, target_branch, message)`.
    pub fn get_merge_to_branch_calls(&self) -> Vec<(String, String, Option<String>)> {
        self.merge_to_branch_calls.lock().unwrap().clone()
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

    /// Set the sync status to return from `sync_status()`.
    pub fn set_sync_status(&self, status: Option<SyncStatus>) {
        *self.sync_status.lock().unwrap() = status;
    }

    /// Set the result for the next `pull_branch` operation.
    pub fn set_next_pull_result(&self, result: Result<(), GitError>) {
        self.pull_results.lock().unwrap().push_back(result);
    }

    /// Set the result for the next `pull_branch_in` operation.
    pub fn set_next_pull_branch_in_result(&self, result: Result<(), GitError>) {
        self.pull_branch_in_results
            .lock()
            .unwrap()
            .push_back(result);
    }

    /// Get the list of `pull_branch_in` calls for verification.
    pub fn get_pull_branch_in_calls(&self) -> Vec<PathBuf> {
        self.pull_branch_in_calls.lock().unwrap().clone()
    }

    /// Get the list of `commit_pending_changes` calls for verification.
    pub fn get_commit_pending_changes_calls(&self) -> Vec<(PathBuf, String)> {
        self.commit_pending_changes_calls.lock().unwrap().clone()
    }

    /// Configure an error to return from the next `force_push_branch` call.
    pub fn set_force_push_error(&self, err: GitError) {
        *self.force_push_error.lock().unwrap() = Some(err);
    }

    /// Get the list of `force_push_branch` calls for verification.
    pub fn get_force_push_calls(&self) -> Vec<String> {
        self.force_push_calls.lock().unwrap().clone()
    }

    /// Push a result for the next `branch_commits` call.
    pub fn push_branch_commits_result(&self, result: Result<Vec<CommitInfo>, GitError>) {
        self.branch_commits_results
            .lock()
            .unwrap()
            .push_back(result);
    }
}

impl Default for MockGitService {
    fn default() -> Self {
        Self::new()
    }
}

impl GitService for MockGitService {
    // -- Worktree --

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
        if self.worktree_exists(task_id) {
            let branch_name = format!("task/{task_id}");
            let worktree_path = PathBuf::from(format!(".orkestra/.worktrees/{task_id}"));
            return Ok(WorktreeCreated {
                branch_name,
                worktree_path,
                base_commit: "mock-base-commit-sha".to_string(),
            });
        }
        self.create_worktree(task_id, base_branch)
    }

    fn run_setup_script(&self, _worktree_path: &Path) -> Result<(), GitError> {
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

    fn list_worktree_names(&self) -> Result<Vec<String>, GitError> {
        Ok(self.worktrees.lock().unwrap().keys().cloned().collect())
    }

    fn get_worktree_state(&self, _worktree_path: &Path) -> Result<WorktreeState, GitError> {
        Ok(WorktreeState {
            head_sha: "mock-sha".to_string(),
            is_dirty: false,
        })
    }

    // -- Branch --

    fn list_branches(&self) -> Result<Vec<String>, GitError> {
        Ok(self.branches.lock().unwrap().clone())
    }

    fn current_branch(&self) -> Result<String, GitError> {
        Ok(self.current_branch.lock().unwrap().clone())
    }

    fn delete_branch(&self, _branch_name: &str) -> Result<(), GitError> {
        Ok(())
    }

    fn is_branch_merged(&self, branch_name: &str, _target_branch: &str) -> Result<bool, GitError> {
        if let Some(&merged) = self.merged_branches.lock().unwrap().get(branch_name) {
            return Ok(merged);
        }
        Ok(false)
    }

    // -- Commit --

    fn has_pending_changes(&self, _worktree_path: &Path) -> Result<bool, GitError> {
        Ok(*self.has_pending_changes.lock().unwrap())
    }

    fn commit_pending_changes(&self, worktree_path: &Path, message: &str) -> Result<(), GitError> {
        self.commit_pending_changes_calls
            .lock()
            .unwrap()
            .push((worktree_path.to_path_buf(), message.to_string()));
        Ok(())
    }

    fn commit_log(&self, _limit: usize) -> Result<Vec<CommitInfo>, GitError> {
        Ok(vec![])
    }

    fn commit_log_at(&self, _path: &Path, _limit: usize) -> Result<Vec<CommitInfo>, GitError> {
        Ok(vec![])
    }

    fn branch_commits(
        &self,
        _worktree_path: &Path,
        _base_branch: &str,
        _limit: usize,
    ) -> Result<Vec<CommitInfo>, GitError> {
        self.branch_commits_results
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(vec![]))
    }

    fn batch_file_counts(&self, _hashes: &[String]) -> Result<HashMap<String, usize>, GitError> {
        Ok(HashMap::new())
    }

    fn read_file_at_head(
        &self,
        _worktree_path: &Path,
        _file_path: &str,
    ) -> Result<Option<String>, GitError> {
        Ok(None)
    }

    // -- Diff --

    fn diff_against_base(
        &self,
        _worktree_path: &Path,
        _branch_name: &str,
        _base_branch: &str,
        _context_lines: u32,
    ) -> Result<TaskDiff, GitError> {
        Ok(TaskDiff { files: vec![] })
    }

    fn diff_uncommitted(&self, _worktree_path: &Path) -> Result<TaskDiff, GitError> {
        Ok(TaskDiff { files: vec![] })
    }

    fn commit_diff(&self, _commit_hash: &str, _context_lines: u32) -> Result<TaskDiff, GitError> {
        Ok(TaskDiff { files: vec![] })
    }

    // -- Merge --

    fn merge_to_branch(
        &self,
        branch_name: &str,
        target_branch: &str,
        message: Option<&str>,
    ) -> Result<MergeResult, GitError> {
        self.merge_to_branch_calls.lock().unwrap().push((
            branch_name.to_string(),
            target_branch.to_string(),
            message.map(String::from),
        ));

        if let Some(result) = self.next_merge_result.lock().unwrap().take() {
            return result;
        }

        Ok(MergeResult {
            commit_sha: format!("mock-sha-{}", branch_name.replace('/', "-")),
            target_branch: target_branch.to_string(),
            merged_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    fn merge_into_worktree(
        &self,
        _worktree_path: &Path,
        _target_branch: &str,
    ) -> Result<(), GitError> {
        if let Some(result) = self.next_merge_into_worktree_result.lock().unwrap().take() {
            return result;
        }
        Ok(())
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

        Ok(true)
    }

    // -- Remote --

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

    fn sync_status(&self) -> Result<Option<SyncStatus>, GitError> {
        Ok(self.sync_status.lock().unwrap().clone())
    }

    fn pull_branch(&self) -> Result<(), GitError> {
        self.pull_results
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(()))
    }

    fn pull_branch_in(&self, worktree_path: &Path) -> Result<(), GitError> {
        self.pull_branch_in_calls
            .lock()
            .unwrap()
            .push(worktree_path.to_path_buf());
        self.pull_branch_in_results
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(()))
    }

    fn fetch_origin(&self) -> Result<(), GitError> {
        Ok(())
    }

    fn force_push_branch(&self, branch: &str) -> Result<(), GitError> {
        self.force_push_calls
            .lock()
            .unwrap()
            .push(branch.to_string());
        if let Some(err) = self.force_push_error.lock().unwrap().take() {
            return Err(err);
        }
        Ok(())
    }

    fn sync_status_for_branch(&self, _branch: &str) -> Result<Option<SyncStatus>, GitError> {
        Ok(self.sync_status.lock().unwrap().clone())
    }
}

// ============================================================================
// Tests
// ============================================================================

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

        let result = mock.merge_to_branch("task/TASK-001", "main", None).unwrap();
        assert!(result.commit_sha.starts_with("mock-sha"));

        mock.set_next_merge_result(Err(GitError::MergeConflict {
            branch: "task/TASK-002".to_string(),
            conflict_files: vec!["file.rs".to_string()],
        }));

        let err = mock
            .merge_to_branch("task/TASK-002", "main", None)
            .unwrap_err();
        assert!(matches!(err, GitError::MergeConflict { .. }));

        let calls = mock.get_merge_to_branch_calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(
            calls[0],
            ("task/TASK-001".to_string(), "main".to_string(), None)
        );
    }

    #[test]
    fn test_mock_squash_commits_default() {
        let mock = MockGitService::new();
        let worktree_path = PathBuf::from("/test/worktree");

        let result = mock
            .squash_commits(&worktree_path, "main", "Squash message")
            .unwrap();
        assert!(result, "Default should return true");

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

        mock.set_next_squash_result(Ok(false));
        let result = mock.squash_commits(&worktree_path, "main", "msg").unwrap();
        assert!(!result, "Should return false when configured");

        mock.set_next_squash_result(Err(GitError::Other("squash failed".into())));
        let err = mock
            .squash_commits(&worktree_path, "main", "msg")
            .unwrap_err();
        assert!(matches!(err, GitError::Other(_)));
    }

    #[test]
    fn test_mock_sync_status() {
        let mock = MockGitService::new();

        assert!(mock.sync_status().unwrap().is_none());

        mock.set_sync_status(Some(SyncStatus {
            ahead: 2,
            behind: 3,
            diverged: true,
        }));
        let status = mock.sync_status().unwrap().unwrap();
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 3);
        assert!(status.diverged);

        mock.set_sync_status(None);
        assert!(mock.sync_status().unwrap().is_none());
    }

    #[test]
    fn test_mock_pull_branch() {
        let mock = MockGitService::new();

        assert!(mock.pull_branch().is_ok());

        mock.set_next_pull_result(Err(GitError::Other("pull failed".into())));
        assert!(mock.pull_branch().is_err());

        mock.set_next_pull_result(Ok(()));
        mock.set_next_pull_result(Err(GitError::Other("second pull failed".into())));
        assert!(mock.pull_branch().is_ok());
        assert!(mock.pull_branch().is_err());
        assert!(mock.pull_branch().is_ok());
    }
}
