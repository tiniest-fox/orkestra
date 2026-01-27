//! Git2-based implementation of the GitService port.
//!
//! Uses git2 crate for repository/branch/worktree operations and git CLI
//! for merge operations (more reliable than git2's merge API).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use git2::{Oid, Repository};

use crate::workflow::ports::{GitError, GitService, MergeResult, WorktreeCreated};

/// Git service implementation using git2 and git CLI.
///
/// Manages the creation of isolated git worktrees for tasks, allowing
/// multiple tasks to work in parallel without code conflicts.
///
/// The Repository is wrapped in a Mutex because git2::Repository is not Sync.
/// Since git operations generally need exclusive access anyway, this is fine.
pub struct Git2GitService {
    repo: Mutex<Repository>,
    repo_path: PathBuf,
    worktrees_dir: PathBuf,
}

impl Git2GitService {
    /// Create a new `Git2GitService` for the given repository path.
    ///
    /// Returns an error if the path is not a git repository.
    pub fn new(repo_path: &Path) -> Result<Self, GitError> {
        let repo = Repository::open(repo_path)
            .map_err(|e| GitError::RepositoryNotFound(format!("Failed to open repository: {e}")))?;
        let worktrees_dir = repo_path.join(".orkestra/worktrees");
        Ok(Self {
            repo: Mutex::new(repo),
            repo_path: repo_path.to_path_buf(),
            worktrees_dir,
        })
    }

    /// Run the worktree setup script if it exists (synchronous, returns errors).
    ///
    /// Looks for `.orkestra/worktree_setup.sh` in the main repo and runs it
    /// with the worktree path as an argument. This allows projects to customize
    /// worktree setup (e.g., copying .env files, running pnpm install).
    ///
    /// Returns an error if the script fails - setup failures should fail the task.
    fn run_worktree_setup(&self, worktree_path: &Path) -> Result<(), GitError> {
        let setup_script = self.repo_path.join(".orkestra/worktree_setup.sh");

        if !setup_script.exists() {
            return Ok(()); // No script = success
        }

        eprintln!(
            "[worktree] Running setup script for {}",
            worktree_path.display()
        );

        let output = Command::new("bash")
            .arg(&setup_script)
            .arg(worktree_path)
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::WorktreeError(format!("Setup script failed to run: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::WorktreeError(format!(
                "Setup script failed: {}",
                stderr.trim()
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        if !stdout.trim().is_empty() {
            eprintln!("[worktree] Setup output: {stdout}");
        }

        Ok(())
    }

    /// Get the commit OID for a branch or HEAD.
    fn get_commit_oid(&self, base_branch: Option<&str>) -> Result<Oid, GitError> {
        let repo = self.repo.lock().expect("Repository mutex poisoned");

        if let Some(branch) = base_branch {
            let branch_ref = repo
                .find_branch(branch, git2::BranchType::Local)
                .map_err(|e| {
                    GitError::BranchError(format!("Failed to find branch '{branch}': {e}"))
                })?;
            let commit = branch_ref.get().peel_to_commit().map_err(|e| {
                GitError::BranchError(format!("Failed to get commit for branch '{branch}': {e}"))
            })?;
            Ok(commit.id())
        } else {
            let head = repo
                .head()
                .map_err(|e| GitError::BranchError(format!("Failed to get HEAD: {e}")))?;
            let commit = head
                .peel_to_commit()
                .map_err(|e| GitError::BranchError(format!("Failed to get commit: {e}")))?;
            Ok(commit.id())
        }
    }

    /// Create a branch from a commit OID.
    fn create_branch_from_oid(&self, branch_name: &str, commit_oid: Oid) -> Result<(), GitError> {
        let repo = self.repo.lock().expect("Repository mutex poisoned");
        let commit = repo
            .find_commit(commit_oid)
            .map_err(|e| GitError::BranchError(format!("Failed to find commit: {e}")))?;
        repo.branch(branch_name, &commit, false)
            .map_err(|e| GitError::BranchError(format!("Failed to create branch: {e}")))?;
        Ok(())
    }

    /// Create a worktree for an existing branch.
    fn create_worktree_for_branch(
        &self,
        task_id: &str,
        branch_name: &str,
        worktree_path: &Path,
    ) -> Result<(), GitError> {
        let repo = self.repo.lock().expect("Repository mutex poisoned");

        let branch = repo
            .find_branch(branch_name, git2::BranchType::Local)
            .map_err(|e| GitError::BranchError(format!("Failed to find branch: {e}")))?;
        let reference = branch.into_reference();

        let mut opts = git2::WorktreeAddOptions::new();
        opts.reference(Some(&reference));

        // git2 API requires &mut but doesn't actually mutate
        #[allow(clippy::unnecessary_mut_passed)]
        repo.worktree(task_id, worktree_path, Some(&mut opts))
            .map_err(|e| GitError::WorktreeError(format!("Failed to create worktree: {e}")))?;

        Ok(())
    }

    /// Internal helper to perform the actual merge operation.
    fn do_merge(&self, primary: &str, branch_name: &str) -> Result<MergeResult, GitError> {
        // First, checkout the primary branch
        let checkout_output = Command::new("git")
            .args(["checkout", primary])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::MergeError(format!("Failed to run git checkout: {e}")))?;

        if !checkout_output.status.success() {
            let stderr = String::from_utf8_lossy(&checkout_output.stderr);
            return Err(GitError::MergeError(format!(
                "Failed to checkout {primary}: {stderr}"
            )));
        }

        // Attempt the merge
        let merge_output = Command::new("git")
            .args(["merge", "--no-edit", branch_name])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::MergeError(format!("Failed to run git merge: {e}")))?;

        if !merge_output.status.success() {
            // Check if this is a merge conflict
            let conflict_files = self.get_conflict_files()?;
            if !conflict_files.is_empty() {
                return Err(GitError::MergeConflict {
                    branch: branch_name.to_string(),
                    conflict_files,
                });
            }
            // Some other merge error
            let stderr = String::from_utf8_lossy(&merge_output.stderr);
            return Err(GitError::MergeError(format!(
                "Failed to merge {branch_name}: {stderr}"
            )));
        }

        // Get the resulting commit SHA
        let head_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::MergeError(format!("Failed to get HEAD: {e}")))?;

        let commit_sha = String::from_utf8_lossy(&head_output.stdout)
            .trim()
            .to_string();

        Ok(MergeResult {
            commit_sha,
            target_branch: primary.to_string(),
            merged_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    /// Check if the main repository has uncommitted changes.
    fn has_uncommitted_changes(&self) -> Result<bool, GitError> {
        let output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git status: {e}")))?;

        let status = String::from_utf8_lossy(&output.stdout);
        Ok(!status.trim().is_empty())
    }

    /// Stash uncommitted changes in the main repository.
    ///
    /// Returns `true` if changes were stashed, `false` if there was nothing to stash.
    fn stash_changes(&self) -> Result<bool, GitError> {
        // Check if there are changes to stash
        if !self.has_uncommitted_changes()? {
            return Ok(false);
        }

        let output = Command::new("git")
            .args(["stash", "push", "-m", "orkestra-temp"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git stash: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::IoError(format!(
                "Failed to stash changes: {stderr}"
            )));
        }

        Ok(true)
    }

    /// Restore stashed changes in the main repository.
    ///
    /// Only pops if we actually stashed something (indicated by `was_stashed`).
    fn stash_pop(&self, was_stashed: bool) -> Result<(), GitError> {
        if !was_stashed {
            return Ok(());
        }

        let output = Command::new("git")
            .args(["stash", "pop"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git stash pop: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Don't fail if there's nothing to pop (edge case)
            if !stderr.contains("No stash entries found") {
                return Err(GitError::IoError(format!(
                    "Failed to restore stashed changes: {stderr}"
                )));
            }
        }

        Ok(())
    }
}

impl GitService for Git2GitService {
    fn create_worktree(
        &self,
        task_id: &str,
        base_branch: Option<&str>,
    ) -> Result<WorktreeCreated, GitError> {
        let branch_name = format!("task/{task_id}");
        let worktree_path = self.worktrees_dir.join(task_id);

        // Ensure worktrees directory exists
        std::fs::create_dir_all(&self.worktrees_dir)?;

        // Get the commit OID to branch from (releases lock)
        let commit_oid = self.get_commit_oid(base_branch)?;

        // Create the branch (acquires and releases lock)
        self.create_branch_from_oid(&branch_name, commit_oid)?;

        // Create the worktree (acquires and releases lock)
        self.create_worktree_for_branch(task_id, &branch_name, &worktree_path)?;

        // Run worktree setup script if it exists
        self.run_worktree_setup(&worktree_path)?;

        Ok(WorktreeCreated {
            branch_name,
            worktree_path,
        })
    }

    fn worktree_exists(&self, task_id: &str) -> bool {
        let repo = self.repo.lock().expect("Repository mutex poisoned");
        repo.find_worktree(task_id).is_ok()
    }

    fn remove_worktree(&self, task_id: &str, delete_branch: bool) -> Result<(), GitError> {
        let worktree_path = self.worktrees_dir.join(task_id);
        let branch_name = format!("task/{task_id}");

        // Prune the worktree from git
        {
            let repo = self.repo.lock().expect("Repository mutex poisoned");
            if let Ok(worktree) = repo.find_worktree(task_id) {
                let mut prune_opts = git2::WorktreePruneOptions::new();
                prune_opts.valid(true);
                worktree.prune(Some(&mut prune_opts)).map_err(|e| {
                    GitError::WorktreeError(format!("Failed to prune worktree: {e}"))
                })?;
            }
        }

        // Remove the directory if it still exists
        if worktree_path.exists() {
            std::fs::remove_dir_all(&worktree_path)?;
        }

        // Delete the branch if requested
        if delete_branch {
            if let Err(e) = self.delete_branch(&branch_name) {
                // Branch may not exist or may be checked out elsewhere - log but don't fail
                eprintln!("[orkestra] WARNING: Failed to delete branch {branch_name}: {e}");
            }
        }

        Ok(())
    }

    fn detect_primary_branch(&self) -> Result<String, GitError> {
        let repo = self.repo.lock().expect("Repository mutex poisoned");

        // Check if 'main' branch exists
        if repo.find_branch("main", git2::BranchType::Local).is_ok() {
            return Ok("main".to_string());
        }
        // Check if 'master' branch exists
        if repo.find_branch("master", git2::BranchType::Local).is_ok() {
            return Ok("master".to_string());
        }
        Err(GitError::BranchError(
            "Could not detect primary branch (neither 'main' nor 'master' found)".into(),
        ))
    }

    fn list_branches(&self) -> Result<Vec<String>, GitError> {
        let output = Command::new("git")
            .args(["branch", "--format=%(refname:short)"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to list branches: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::BranchError(format!(
                "Failed to list branches: {stderr}"
            )));
        }

        let branches: Vec<String> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|s| !s.is_empty())
            .filter(|s| !s.starts_with("task/")) // Exclude worktree branches
            .map(String::from)
            .collect();

        Ok(branches)
    }

    fn current_branch(&self) -> Result<String, GitError> {
        let output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to get current branch: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::BranchError(format!(
                "Failed to get current branch: {stderr}"
            )));
        }

        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(branch)
    }

    fn commit_pending_changes(&self, worktree_path: &Path, message: &str) -> Result<(), GitError> {
        // Check if there are any changes (staged or unstaged)
        let status_output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git status: {e}")))?;

        let status = String::from_utf8_lossy(&status_output.stdout);
        if status.trim().is_empty() {
            // No changes to commit
            return Ok(());
        }

        // Stage all changes
        let add_output = Command::new("git")
            .args(["add", "-A"])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git add: {e}")))?;

        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr);
            return Err(GitError::IoError(format!(
                "Failed to stage changes: {stderr}"
            )));
        }

        // Commit
        let commit_output = Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git commit: {e}")))?;

        if !commit_output.status.success() {
            let stderr = String::from_utf8_lossy(&commit_output.stderr);
            // "nothing to commit" is not an error
            if !stderr.contains("nothing to commit") {
                return Err(GitError::IoError(format!("Failed to commit: {stderr}")));
            }
        }

        Ok(())
    }

    fn merge_to_primary(&self, branch_name: &str) -> Result<MergeResult, GitError> {
        let primary = self.detect_primary_branch()?;

        // Stash any uncommitted changes in the main repo before merge
        let was_stashed = self.stash_changes()?;

        // Use a closure to ensure stash is always popped, even on error
        let merge_result = self.do_merge(&primary, branch_name);

        // Always restore stashed changes
        if let Err(e) = self.stash_pop(was_stashed) {
            eprintln!("Warning: Failed to restore stashed changes: {e}");
        }

        merge_result
    }

    fn get_conflict_files(&self) -> Result<Vec<String>, GitError> {
        let output = Command::new("git")
            .args(["diff", "--name-only", "--diff-filter=U"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to get conflict files: {e}")))?;

        let files = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();
        Ok(files)
    }

    fn abort_merge(&self) -> Result<(), GitError> {
        let output = Command::new("git")
            .args(["merge", "--abort"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::MergeError(format!("Failed to abort merge: {e}")))?;

        if !output.status.success() {
            // It's okay if there's nothing to abort
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("no merge to abort") {
                return Err(GitError::MergeError(format!(
                    "Failed to abort merge: {stderr}"
                )));
            }
        }
        Ok(())
    }

    fn delete_branch(&self, branch_name: &str) -> Result<(), GitError> {
        // Use -D to force delete (branch may not be fully merged from git's perspective
        // if it was a fast-forward merge)
        let output = Command::new("git")
            .args(["branch", "-D", branch_name])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::BranchError(format!("Failed to delete branch: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::BranchError(format!(
                "Failed to delete branch {branch_name}: {stderr}"
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    /// Create a test git repository with an initial commit
    fn create_test_repo() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo_path = temp_dir.path().to_path_buf();

        // Initialize git repo
        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to init git repo");

        // Configure git user for commits
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

        // Create initial commit
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

        // Rename default branch to 'main' for consistency
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

        // Branch should be deleted
        let branches = git.list_branches().expect("Failed to list branches");
        assert!(!branches.iter().any(|b| b == "task/TASK-002"));
    }

    #[test]
    fn test_remove_worktree_keep_branch() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        git.create_worktree("TASK-003", None)
            .expect("Failed to create worktree");

        git.remove_worktree("TASK-003", false)
            .expect("Failed to remove worktree");
        assert!(!git.worktree_exists("TASK-003"));

        // Branch should still exist (task/* branches are filtered from list_branches,
        // so we check directly with git)
        let output = Command::new("git")
            .args(["branch", "--list", "task/TASK-003"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to list branches");
        let branch_list = String::from_utf8_lossy(&output.stdout);
        assert!(branch_list.contains("task/TASK-003"));
    }

    #[test]
    fn test_detect_primary_branch() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let primary = git
            .detect_primary_branch()
            .expect("Failed to detect primary branch");
        assert_eq!(primary, "main");
    }

    #[test]
    fn test_current_branch() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let current = git.current_branch().expect("Failed to get current branch");
        assert_eq!(current, "main");
    }

    #[test]
    fn test_list_branches_excludes_task_branches() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create a worktree (which creates a task/* branch)
        git.create_worktree("TASK-004", None)
            .expect("Failed to create worktree");

        let branches = git.list_branches().expect("Failed to list branches");
        assert!(branches.contains(&"main".to_string()));
        assert!(!branches.iter().any(|b| b.starts_with("task/")));
    }

    #[test]
    fn test_merge_to_primary() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create worktree and add a commit
        let worktree = git
            .create_worktree("TASK-005", None)
            .expect("Failed to create worktree");

        std::fs::write(worktree.worktree_path.join("new_file.txt"), "Hello")
            .expect("Failed to write file");

        git.commit_pending_changes(&worktree.worktree_path, "Add new file")
            .expect("Failed to commit");

        // Merge to main
        let result = git
            .merge_to_primary("task/TASK-005")
            .expect("Failed to merge");

        assert_eq!(result.target_branch, "main");
        assert!(!result.commit_sha.is_empty());
        assert!(!result.merged_at.is_empty());

        // Verify the file exists in main
        assert!(repo_path.join("new_file.txt").exists());
    }

    #[test]
    fn test_commit_pending_changes_no_changes() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // No changes - should be a no-op
        git.commit_pending_changes(&repo_path, "Test commit")
            .expect("Should succeed with no changes");
    }
}
