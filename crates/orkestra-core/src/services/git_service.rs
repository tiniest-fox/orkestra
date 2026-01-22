use std::path::{Path, PathBuf};

use git2::Repository;

use crate::error::{OrkestraError, Result};

/// Service for git worktree operations.
///
/// Manages the creation of isolated git worktrees for tasks, allowing
/// multiple tasks to work in parallel without code conflicts.
pub struct GitService {
    repo: Repository,
    worktrees_dir: PathBuf,
}

impl GitService {
    /// Create a new GitService for the given repository path.
    ///
    /// Returns None if the path is not a git repository.
    pub fn new(repo_path: &Path) -> Result<Self> {
        let repo = Repository::open(repo_path)
            .map_err(|e| OrkestraError::GitError(format!("Failed to open repository: {e}")))?;
        let worktrees_dir = repo_path.join(".orkestra/worktrees");
        Ok(Self { repo, worktrees_dir })
    }

    /// Create a worktree for a task.
    ///
    /// Creates a new branch `task/{task_id}` from HEAD and a worktree at
    /// `.orkestra/worktrees/{task_id}`.
    ///
    /// Returns (branch_name, worktree_path).
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

        self.repo
            .worktree(task_id, &worktree_path, Some(&mut opts))
            .map_err(|e| OrkestraError::GitError(format!("Failed to create worktree: {e}")))?;

        Ok((branch_name, worktree_path))
    }

    /// Check if a worktree exists for the given task ID.
    pub fn worktree_exists(&self, task_id: &str) -> bool {
        self.repo.find_worktree(task_id).is_ok()
    }

    /// Remove a worktree (for cleanup when task is done/failed).
    ///
    /// Note: This is not currently used but provided for future cleanup functionality.
    #[allow(dead_code)]
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
}
