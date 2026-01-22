use std::path::{Path, PathBuf};
use std::process::Command;

use git2::Repository;

use crate::error::{OrkestraError, Result};

/// Service for git worktree operations.
///
/// Manages the creation of isolated git worktrees for tasks, allowing
/// multiple tasks to work in parallel without code conflicts.
pub struct GitService {
    repo: Repository,
    repo_path: PathBuf,
    worktrees_dir: PathBuf,
}

impl GitService {
    /// Create a new `GitService` for the given repository path.
    ///
    /// Returns an error if the path is not a git repository.
    pub fn new(repo_path: &Path) -> Result<Self> {
        let repo = Repository::open(repo_path)
            .map_err(|e| OrkestraError::GitError(format!("Failed to open repository: {e}")))?;
        let worktrees_dir = repo_path.join(".orkestra/worktrees");
        Ok(Self {
            repo,
            repo_path: repo_path.to_path_buf(),
            worktrees_dir,
        })
    }

    /// Create a worktree for a task.
    ///
    /// Creates a new branch `task/{task_id}` from HEAD and a worktree at
    /// `.orkestra/worktrees/{task_id}`.
    ///
    /// Returns (`branch_name`, `worktree_path`).
    pub fn create_worktree(&self, task_id: &str) -> Result<(String, PathBuf)> {
        let branch_name = format!("task/{task_id}");
        let worktree_path = self.worktrees_dir.join(task_id);

        // Ensure worktrees directory exists
        std::fs::create_dir_all(&self.worktrees_dir)?;

        // Get the current HEAD commit
        let head = self
            .repo
            .head()
            .map_err(|e| OrkestraError::GitError(format!("Failed to get HEAD: {e}")))?;
        let commit = head
            .peel_to_commit()
            .map_err(|e| OrkestraError::GitError(format!("Failed to get commit: {e}")))?;

        // Create the branch
        self.repo
            .branch(&branch_name, &commit, false)
            .map_err(|e| OrkestraError::GitError(format!("Failed to create branch: {e}")))?;

        // Create the worktree with reference to the branch
        let branch = self
            .repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .map_err(|e| OrkestraError::GitError(format!("Failed to find branch: {e}")))?;
        let reference = branch.into_reference();

        let mut opts = git2::WorktreeAddOptions::new();
        opts.reference(Some(&reference));

        // git2 API requires &mut but doesn't actually mutate
        #[allow(clippy::unnecessary_mut_passed)]
        self.repo
            .worktree(task_id, &worktree_path, Some(&mut opts))
            .map_err(|e| OrkestraError::GitError(format!("Failed to create worktree: {e}")))?;

        Ok((branch_name, worktree_path))
    }

    /// Check if a worktree exists for the given task ID.
    pub fn worktree_exists(&self, task_id: &str) -> bool {
        self.repo.find_worktree(task_id).is_ok()
    }

    /// Remove a worktree (for cleanup when task is done).
    pub fn remove_worktree(&self, task_id: &str) -> Result<()> {
        let worktree_path = self.worktrees_dir.join(task_id);

        // Prune the worktree from git
        if let Ok(worktree) = self.repo.find_worktree(task_id) {
            let mut prune_opts = git2::WorktreePruneOptions::new();
            prune_opts.valid(true);
            worktree
                .prune(Some(&mut prune_opts))
                .map_err(|e| OrkestraError::GitError(format!("Failed to prune worktree: {e}")))?;
        }

        // Remove the directory if it still exists
        if worktree_path.exists() {
            std::fs::remove_dir_all(&worktree_path)?;
        }

        Ok(())
    }

    /// Detect the primary branch (main or master).
    pub fn detect_primary_branch(&self) -> Result<String> {
        // Check if 'main' branch exists
        if self
            .repo
            .find_branch("main", git2::BranchType::Local)
            .is_ok()
        {
            return Ok("main".to_string());
        }
        // Check if 'master' branch exists
        if self
            .repo
            .find_branch("master", git2::BranchType::Local)
            .is_ok()
        {
            return Ok("master".to_string());
        }
        Err(OrkestraError::GitError(
            "Could not detect primary branch (neither 'main' nor 'master' found)".into(),
        ))
    }

    /// Merge a task branch into the primary branch.
    ///
    /// Uses git CLI for reliability (git2 merge API is complex).
    /// Returns the merge commit SHA on success.
    pub fn merge_to_primary(&self, branch_name: &str) -> Result<String> {
        let primary = self.detect_primary_branch()?;

        // First, checkout the primary branch
        let checkout_output = Command::new("git")
            .args(["checkout", &primary])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| OrkestraError::GitError(format!("Failed to run git checkout: {e}")))?;

        if !checkout_output.status.success() {
            let stderr = String::from_utf8_lossy(&checkout_output.stderr);
            return Err(OrkestraError::GitError(format!(
                "Failed to checkout {primary}: {stderr}"
            )));
        }

        // Attempt the merge
        let merge_output = Command::new("git")
            .args(["merge", "--no-edit", branch_name])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| OrkestraError::GitError(format!("Failed to run git merge: {e}")))?;

        if !merge_output.status.success() {
            // Check if this is a merge conflict
            let conflict_files = self.get_conflict_files()?;
            if !conflict_files.is_empty() {
                return Err(OrkestraError::MergeConflict {
                    branch: branch_name.to_string(),
                    files: conflict_files,
                });
            }
            // Some other merge error
            let stderr = String::from_utf8_lossy(&merge_output.stderr);
            return Err(OrkestraError::GitError(format!(
                "Failed to merge {branch_name}: {stderr}"
            )));
        }

        // Get the resulting commit SHA
        let head_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| OrkestraError::GitError(format!("Failed to get HEAD: {e}")))?;

        let commit_sha = String::from_utf8_lossy(&head_output.stdout)
            .trim()
            .to_string();
        Ok(commit_sha)
    }

    /// Get list of files in conflict after a failed merge.
    pub fn get_conflict_files(&self) -> Result<Vec<String>> {
        let output = Command::new("git")
            .args(["diff", "--name-only", "--diff-filter=U"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| OrkestraError::GitError(format!("Failed to get conflict files: {e}")))?;

        let files = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();
        Ok(files)
    }

    /// Abort a merge in progress.
    pub fn abort_merge(&self) -> Result<()> {
        let output = Command::new("git")
            .args(["merge", "--abort"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| OrkestraError::GitError(format!("Failed to abort merge: {e}")))?;

        if !output.status.success() {
            // It's okay if there's nothing to abort
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("no merge to abort") {
                return Err(OrkestraError::GitError(format!(
                    "Failed to abort merge: {stderr}"
                )));
            }
        }
        Ok(())
    }

    /// Delete a branch after successful merge.
    pub fn delete_branch(&self, branch_name: &str) -> Result<()> {
        // Use -D to force delete (branch may not be fully merged from git's perspective
        // if it was a fast-forward merge)
        let output = Command::new("git")
            .args(["branch", "-D", branch_name])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| OrkestraError::GitError(format!("Failed to delete branch: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(OrkestraError::GitError(format!(
                "Failed to delete branch {branch_name}: {stderr}"
            )));
        }
        Ok(())
    }
}
