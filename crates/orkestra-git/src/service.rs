//! Git2-based implementation of the `GitService` trait.
//!
//! Delegates each trait method to an Interaction in `interactions/`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use git2::Repository;

use crate::interactions;
use crate::interface::GitService;
use crate::types::{
    CommitInfo, GitError, MergeResult, SyncStatus, TaskDiff, WorktreeCreated, WorktreeState,
};

/// Git service implementation using git2 and git CLI.
///
/// The Repository is wrapped in a Mutex because `git2::Repository` is not Sync.
pub struct Git2GitService {
    repo: Mutex<Repository>,
    repo_path: PathBuf,
    worktrees_dir: PathBuf,
}

impl Git2GitService {
    /// Create a new `Git2GitService` for the given repository path.
    pub fn new(repo_path: &Path) -> Result<Self, GitError> {
        let repo = Repository::open(repo_path)
            .map_err(|e| GitError::RepositoryNotFound(format!("Failed to open repository: {e}")))?;
        let worktrees_dir = repo_path.join(".orkestra/.worktrees");
        Ok(Self {
            repo: Mutex::new(repo),
            repo_path: repo_path.to_path_buf(),
            worktrees_dir,
        })
    }
}

impl GitService for Git2GitService {
    // -- Worktree --

    fn create_worktree(
        &self,
        task_id: &str,
        base_branch: Option<&str>,
    ) -> Result<WorktreeCreated, GitError> {
        let result = self.ensure_worktree(task_id, base_branch)?;
        interactions::worktree::setup_script::execute(&self.repo_path, &result.worktree_path)?;
        Ok(result)
    }

    fn ensure_worktree(
        &self,
        task_id: &str,
        base_branch: Option<&str>,
    ) -> Result<WorktreeCreated, GitError> {
        interactions::worktree::create::execute(
            &self.repo,
            &self.worktrees_dir,
            task_id,
            base_branch,
        )
    }

    fn run_setup_script(&self, worktree_path: &Path) -> Result<(), GitError> {
        interactions::worktree::setup_script::execute(&self.repo_path, worktree_path)
    }

    fn worktree_exists(&self, task_id: &str) -> bool {
        interactions::worktree::exists::execute(&self.repo, task_id)
    }

    fn remove_worktree(&self, task_id: &str, delete_branch: bool) -> Result<(), GitError> {
        interactions::worktree::remove::execute(
            &self.repo,
            &self.worktrees_dir,
            task_id,
            delete_branch,
        )
    }

    fn list_worktree_names(&self) -> Result<Vec<String>, GitError> {
        interactions::worktree::list::execute(&self.repo, &self.worktrees_dir)
    }

    fn get_worktree_state(&self, worktree_path: &Path) -> Result<WorktreeState, GitError> {
        interactions::worktree::get_state::execute(worktree_path)
    }

    // -- Branch --

    fn list_branches(&self) -> Result<Vec<String>, GitError> {
        interactions::branch::list::execute(&self.repo_path)
    }

    fn current_branch(&self) -> Result<String, GitError> {
        interactions::branch::current::execute(&self.repo_path)
    }

    fn delete_branch(&self, branch_name: &str) -> Result<(), GitError> {
        interactions::branch::delete::execute(&self.repo, branch_name)
    }

    fn is_branch_merged(&self, branch_name: &str, target_branch: &str) -> Result<bool, GitError> {
        interactions::branch::is_merged::execute(&self.repo_path, branch_name, target_branch)
    }

    // -- Commit --

    fn has_pending_changes(&self, worktree_path: &Path) -> Result<bool, GitError> {
        interactions::commit::has_pending_changes::execute(worktree_path)
    }

    fn commit_pending_changes(&self, worktree_path: &Path, message: &str) -> Result<(), GitError> {
        interactions::commit::create::execute(worktree_path, message)
    }

    fn commit_log(&self, limit: usize) -> Result<Vec<CommitInfo>, GitError> {
        interactions::commit::log::execute(&self.repo_path, limit)
    }

    fn commit_log_at(&self, path: &Path, limit: usize) -> Result<Vec<CommitInfo>, GitError> {
        interactions::commit::log::execute(path, limit)
    }

    fn batch_file_counts(&self, hashes: &[String]) -> Result<HashMap<String, usize>, GitError> {
        interactions::commit::batch_file_counts::execute(&self.repo_path, hashes)
    }

    fn read_file_at_head(
        &self,
        worktree_path: &Path,
        file_path: &str,
    ) -> Result<Option<String>, GitError> {
        interactions::commit::read_file_at_head::execute(worktree_path, file_path)
    }

    // -- Diff --

    fn diff_against_base(
        &self,
        worktree_path: &Path,
        branch_name: &str,
        base_branch: &str,
        context_lines: u32,
    ) -> Result<TaskDiff, GitError> {
        interactions::diff::against_base::execute(
            worktree_path,
            branch_name,
            base_branch,
            context_lines,
        )
    }

    fn diff_uncommitted(&self, worktree_path: &Path) -> Result<TaskDiff, GitError> {
        interactions::diff::uncommitted::execute(worktree_path)
    }

    fn commit_diff(&self, commit_hash: &str, context_lines: u32) -> Result<TaskDiff, GitError> {
        interactions::diff::commit::execute(&self.repo_path, commit_hash, context_lines)
    }

    // -- Merge --

    fn merge_to_branch(
        &self,
        branch_name: &str,
        target_branch: &str,
        message: Option<&str>,
    ) -> Result<MergeResult, GitError> {
        interactions::merge::fast_forward::execute(
            &self.repo_path,
            &self.worktrees_dir,
            branch_name,
            target_branch,
            message,
        )
    }

    fn merge_into_worktree(
        &self,
        worktree_path: &Path,
        target_branch: &str,
    ) -> Result<(), GitError> {
        interactions::merge::merge_into_worktree::execute(worktree_path, target_branch)
    }

    fn rebase_on_branch(&self, worktree_path: &Path, target_branch: &str) -> Result<(), GitError> {
        interactions::merge::rebase::execute(worktree_path, target_branch)
    }

    fn squash_commits(
        &self,
        worktree_path: &Path,
        target_branch: &str,
        message: &str,
    ) -> Result<bool, GitError> {
        interactions::merge::squash::execute(worktree_path, target_branch, message)
    }

    // -- Remote --

    fn push_branch(&self, branch: &str) -> Result<(), GitError> {
        interactions::remote::push::execute(&self.repo_path, branch)
    }

    fn sync_base_branch(&self, branch: &str) -> Result<(), GitError> {
        interactions::remote::sync_base::execute(&self.repo_path, branch)
    }

    fn sync_status(&self) -> Result<Option<SyncStatus>, GitError> {
        interactions::remote::sync_status::execute(&self.repo_path, None)
    }

    fn pull_branch(&self) -> Result<(), GitError> {
        interactions::remote::pull::execute(&self.repo_path)
    }

    fn pull_branch_in(&self, worktree_path: &Path) -> Result<(), GitError> {
        interactions::remote::pull::execute(worktree_path)
    }

    fn fetch_origin(&self) -> Result<(), GitError> {
        interactions::remote::fetch::execute(&self.repo_path)
    }

    fn force_push_branch(&self, branch: &str) -> Result<(), GitError> {
        interactions::remote::force_push::execute(&self.repo_path, branch)
    }

    fn sync_status_for_branch(&self, branch: &str) -> Result<Option<SyncStatus>, GitError> {
        interactions::remote::sync_status::execute(&self.repo_path, Some(branch))
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::FileChangeType;
    use std::process::Command;
    use tempfile::TempDir;

    fn create_test_repo() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo_path = temp_dir.path().to_path_buf();

        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to init git repo");

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to configure git email");

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to configure git name");

        std::fs::write(repo_path.join("README.md"), "# Test Repo").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add files");
        Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to rename branch");

        (temp_dir, repo_path)
    }

    #[test]
    fn test_create_worktree() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let result = git
            .create_worktree("TASK-001", Some("main"))
            .expect("Failed to create worktree");

        assert_eq!(result.branch_name, "task/TASK-001");
        assert!(result.worktree_path.exists());
        assert!(git.worktree_exists("TASK-001"));
    }

    #[test]
    fn test_remove_worktree_with_branch() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        git.create_worktree("TASK-002", None)
            .expect("Failed to create worktree");
        assert!(git.worktree_exists("TASK-002"));

        git.remove_worktree("TASK-002", true)
            .expect("Failed to remove worktree");
        assert!(!git.worktree_exists("TASK-002"));

        let output = Command::new("git")
            .args(["branch", "--list", "task/TASK-002"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to list branches");
        let branch_list = String::from_utf8_lossy(&output.stdout);
        assert!(!branch_list.contains("task/TASK-002"));
    }

    #[test]
    fn test_current_branch() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let current = git.current_branch().expect("Failed to get current branch");
        assert_eq!(current, "main");
    }

    #[test]
    fn test_merge_to_branch() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let worktree = git
            .create_worktree("TASK-005", None)
            .expect("Failed to create worktree");

        std::fs::write(worktree.worktree_path.join("new_file.txt"), "Hello")
            .expect("Failed to write file");

        git.commit_pending_changes(&worktree.worktree_path, "Add new file")
            .expect("Failed to commit");

        let result = git
            .merge_to_branch("task/TASK-005", "main", None)
            .expect("Failed to merge");

        assert_eq!(result.target_branch, "main");
        assert!(!result.commit_sha.is_empty());
        assert!(repo_path.join("new_file.txt").exists());
    }

    #[test]
    fn test_merge_to_branch_with_message() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let worktree = git
            .create_worktree("TASK-MSG", None)
            .expect("Failed to create worktree");

        std::fs::write(worktree.worktree_path.join("msg_file.txt"), "Hello")
            .expect("Failed to write file");

        git.commit_pending_changes(&worktree.worktree_path, "Add msg file")
            .expect("Failed to commit");

        let result = git
            .merge_to_branch("task/TASK-MSG", "main", Some("Custom merge message"))
            .expect("Failed to merge");

        assert_eq!(result.target_branch, "main");
        assert!(!result.commit_sha.is_empty());

        // Verify the custom message was used as the merge commit subject
        let subject_output = Command::new("git")
            .args(["log", "-1", "--format=%s"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to get log");
        let subject = String::from_utf8_lossy(&subject_output.stdout)
            .trim()
            .to_string();
        assert_eq!(
            subject, "Custom merge message",
            "Merge commit subject should match the provided message"
        );

        // Verify it's an explicit merge commit (has 2 parents)
        let parents_output = Command::new("git")
            .args(["log", "-1", "--format=%P"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to get parent SHAs");
        let parents = String::from_utf8_lossy(&parents_output.stdout)
            .trim()
            .to_string();
        let parent_count = parents.split_whitespace().count();
        assert_eq!(
            parent_count, 2,
            "--no-ff merge should produce a commit with 2 parents, got: {parents}"
        );
    }

    #[test]
    fn test_squash_commits() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let worktree = git
            .create_worktree("TASK-SQUASH", None)
            .expect("Failed to create worktree");

        // Create multiple commits
        for i in 1..=3 {
            std::fs::write(
                worktree.worktree_path.join(format!("file{i}.txt")),
                format!("commit {i}"),
            )
            .expect("Failed to write file");
            git.commit_pending_changes(&worktree.worktree_path, &format!("Commit {i}"))
                .expect("Failed to commit");
        }

        let result = git
            .squash_commits(&worktree.worktree_path, "main", "Squashed: all changes")
            .expect("Failed to squash");

        assert!(result);

        // Verify single commit
        let log_output = Command::new("git")
            .args(["log", "--oneline", "main..HEAD"])
            .current_dir(&worktree.worktree_path)
            .output()
            .expect("Failed to get log");
        let log_text = String::from_utf8_lossy(&log_output.stdout);
        let count = log_text.lines().filter(|l| !l.is_empty()).count();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_is_branch_merged() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let worktree = git
            .create_worktree("TASK-MERGED", None)
            .expect("Failed to create worktree");
        std::fs::write(worktree.worktree_path.join("merged.txt"), "content")
            .expect("Failed to write");
        git.commit_pending_changes(&worktree.worktree_path, "Add file")
            .expect("Failed to commit");
        git.merge_to_branch("task/TASK-MERGED", "main", None)
            .expect("Failed to merge");

        assert!(git
            .is_branch_merged("task/TASK-MERGED", "main")
            .expect("Should check merge status"));

        // Missing branch treated as merged
        assert!(git
            .is_branch_merged("task/NONEXISTENT", "main")
            .expect("Should check merge status"));
    }

    #[test]
    fn test_commit_log() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        std::fs::write(repo_path.join("file2.txt"), "second").expect("Failed to write");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "Second commit"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        let commits = git.commit_log(20).expect("Failed to get commit log");
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].message, "Second commit");
        assert_eq!(commits[1].message, "Initial commit");
    }

    #[test]
    fn test_commit_diff() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        std::fs::write(repo_path.join("new_file.rs"), "fn main() {}\n")
            .expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "Add new_file.rs"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        let output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        let commit_hash = String::from_utf8_lossy(&output.stdout).trim().to_string();

        let diff = git
            .commit_diff(&commit_hash, 3)
            .expect("Failed to get diff");
        assert_eq!(diff.files.len(), 1);
        assert_eq!(diff.files[0].path, "new_file.rs");
        assert!(matches!(diff.files[0].change_type, FileChangeType::Added));
    }

    fn create_test_repo_with_remote() -> (TempDir, TempDir, PathBuf) {
        let remote_dir = TempDir::new().expect("Failed to create remote temp dir");
        Command::new("git")
            .args(["init", "--bare"])
            .current_dir(remote_dir.path())
            .output()
            .expect("Failed to init bare repo");
        Command::new("git")
            .args(["symbolic-ref", "HEAD", "refs/heads/main"])
            .current_dir(remote_dir.path())
            .output()
            .expect("Failed to set default branch");

        let clone_dir = TempDir::new().expect("Failed to create clone temp dir");
        let repo_path = clone_dir.path().to_path_buf();

        Command::new("git")
            .args(["clone", remote_dir.path().to_str().unwrap(), "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to clone repo");

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        std::fs::write(repo_path.join("README.md"), "# Test Repo").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["push", "-u", "origin", "main"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["checkout", "-b", "task/test"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        (remote_dir, clone_dir, repo_path)
    }

    #[test]
    fn test_sync_base_branch() {
        let (remote_dir, _clone_dir, repo_path) = create_test_repo_with_remote();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Push a commit from another clone
        let other_clone = TempDir::new().unwrap();
        Command::new("git")
            .args(["clone", remote_dir.path().to_str().unwrap(), "."])
            .current_dir(other_clone.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "other@example.com"])
            .current_dir(other_clone.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Other User"])
            .current_dir(other_clone.path())
            .output()
            .unwrap();
        std::fs::write(other_clone.path().join("new_file.txt"), "new content").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(other_clone.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "New commit from other clone"])
            .current_dir(other_clone.path())
            .output()
            .unwrap();
        Command::new("git")
            .args(["push"])
            .current_dir(other_clone.path())
            .output()
            .unwrap();

        git.sync_base_branch("main").expect("Sync should succeed");

        let log_output = Command::new("git")
            .args(["log", "--oneline", "-1", "main"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        let log_text = String::from_utf8_lossy(&log_output.stdout);
        assert!(log_text.contains("New commit from other clone"));
    }
}
