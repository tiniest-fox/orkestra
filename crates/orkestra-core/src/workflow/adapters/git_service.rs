//! Git2-based implementation of the `GitService` port.
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
/// The Repository is wrapped in a Mutex because `git2::Repository` is not Sync.
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
        let worktrees_dir = repo_path.join(".orkestra/.worktrees");
        Ok(Self {
            repo: Mutex::new(repo),
            repo_path: repo_path.to_path_buf(),
            worktrees_dir,
        })
    }

    /// Run the worktree setup script if it exists (synchronous, returns errors).
    ///
    /// Looks for `.orkestra/scripts/worktree_setup.sh` in the main repo and runs it
    /// with the worktree path as an argument. This allows projects to customize
    /// worktree setup (e.g., copying .env files, running pnpm install).
    ///
    /// Returns an error if the script fails - setup failures should fail the task.
    fn run_worktree_setup(&self, worktree_path: &Path) -> Result<(), GitError> {
        let setup_script = self.repo_path.join(".orkestra/scripts/worktree_setup.sh");

        if !setup_script.exists() {
            return Ok(()); // No script = success
        }

        crate::orkestra_debug!(
            "worktree",
            "Running setup script for {}",
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
            let stdout = String::from_utf8_lossy(&output.stdout);
            let error_output = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else if !stdout.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                format!("exit code {}", output.status.code().unwrap_or(-1))
            };
            return Err(GitError::WorktreeError(format!(
                "Setup script failed: {error_output}"
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        if !stdout.trim().is_empty() {
            crate::orkestra_debug!("worktree", "Setup output: {stdout}");
        }

        Ok(())
    }

    /// Get the commit OID for a branch or HEAD.
    fn get_commit_oid(&self, base_branch: Option<&str>) -> Result<Oid, GitError> {
        let repo = self
            .repo
            .lock()
            .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;

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
        let repo = self
            .repo
            .lock()
            .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;
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
        let repo = self
            .repo
            .lock()
            .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;

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

    /// Resolve a branch name to the working directory where it's checked out.
    ///
    /// - `task/*` branches → worktree path (must exist)
    /// - Everything else → main repo path
    fn resolve_branch_working_dir(&self, branch: &str) -> Result<PathBuf, GitError> {
        if let Some(task_id) = branch.strip_prefix("task/") {
            let worktree_path = self.worktrees_dir.join(task_id);
            if worktree_path.join(".git").exists() {
                return Ok(worktree_path);
            }
            return Err(GitError::WorktreeError(format!(
                "Worktree for task branch '{branch}' not found at {}",
                worktree_path.display()
            )));
        }
        Ok(self.repo_path.clone())
    }

    /// Perform fast-forward merge in a specific working directory.
    fn fast_forward_merge(
        working_dir: &Path,
        source: &str,
        target: &str,
    ) -> Result<MergeResult, GitError> {
        // Detect if this is a worktree by checking if .git is a file (not a directory)
        let is_worktree = working_dir.join(".git").is_file();

        if !is_worktree {
            // Checkout the target branch (only needed in main repo)
            let checkout_output = Command::new("git")
                .args(["checkout", target])
                .current_dir(working_dir)
                .output()
                .map_err(|e| {
                    GitError::MergeError(format!(
                        "Failed to checkout {target} in {}: {e}",
                        working_dir.display()
                    ))
                })?;

            if !checkout_output.status.success() {
                let stderr = String::from_utf8_lossy(&checkout_output.stderr);
                return Err(GitError::MergeError(format!(
                    "Failed to checkout {target} in {}: {stderr}",
                    working_dir.display()
                )));
            }
        }

        // Fast-forward merge — after rebase this is always ff
        let merge_output = Command::new("git")
            .args(["merge", "--ff-only", source])
            .current_dir(working_dir)
            .output()
            .map_err(|e| {
                GitError::MergeError(format!(
                    "Failed to merge {source} into {target} in {}: {e}",
                    working_dir.display()
                ))
            })?;

        if !merge_output.status.success() {
            let stderr = String::from_utf8_lossy(&merge_output.stderr);
            return Err(GitError::MergeError(format!(
                "Failed to merge {source} into {target} in {}: {stderr}",
                working_dir.display()
            )));
        }

        // Get the resulting commit SHA
        let head_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(working_dir)
            .output()
            .map_err(|e| {
                GitError::MergeError(format!(
                    "Failed to get HEAD in {}: {e}",
                    working_dir.display()
                ))
            })?;

        if !head_output.status.success() {
            let stderr = String::from_utf8_lossy(&head_output.stderr);
            return Err(GitError::MergeError(format!(
                "Failed to get HEAD after merge in {}: {stderr}",
                working_dir.display()
            )));
        }

        let commit_sha = String::from_utf8_lossy(&head_output.stdout)
            .trim()
            .to_string();

        Ok(MergeResult {
            commit_sha,
            target_branch: target.to_string(),
            merged_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    /// Check if a working directory has uncommitted changes.
    fn has_uncommitted_changes(working_dir: &Path) -> Result<bool, GitError> {
        let output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(working_dir)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git status: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::IoError(format!(
                "Failed to check uncommitted changes in {}: {stderr}",
                working_dir.display()
            )));
        }

        let status = String::from_utf8_lossy(&output.stdout);
        Ok(!status.trim().is_empty())
    }

    /// Stash uncommitted changes in a working directory.
    ///
    /// Returns `true` if changes were stashed, `false` if there was nothing to stash.
    fn stash_changes(working_dir: &Path) -> Result<bool, GitError> {
        if !Self::has_uncommitted_changes(working_dir)? {
            return Ok(false);
        }

        let output = Command::new("git")
            .args(["stash", "push", "-m", "orkestra-temp"])
            .current_dir(working_dir)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git stash: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::IoError(format!(
                "Failed to stash changes in {}: {stderr}",
                working_dir.display()
            )));
        }

        Ok(true)
    }

    /// Restore stashed changes in a working directory.
    ///
    /// Only pops if we actually stashed something (indicated by `was_stashed`).
    fn stash_pop(working_dir: &Path, was_stashed: bool) -> Result<(), GitError> {
        if !was_stashed {
            return Ok(());
        }

        let output = Command::new("git")
            .args(["stash", "pop"])
            .current_dir(working_dir)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git stash pop: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Don't fail if there's nothing to pop (edge case)
            if !stderr.contains("No stash entries found") {
                return Err(GitError::IoError(format!(
                    "Failed to restore stashed changes in {}: {stderr}",
                    working_dir.display()
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
        // Full creation: ensure worktree + run setup script
        let result = self.ensure_worktree(task_id, base_branch)?;
        self.run_worktree_setup(&result.worktree_path)?;
        Ok(result)
    }

    fn ensure_worktree(
        &self,
        task_id: &str,
        base_branch: Option<&str>,
    ) -> Result<WorktreeCreated, GitError> {
        let branch_name = format!("task/{task_id}");
        let worktree_path = self.worktrees_dir.join(task_id);

        // If worktree already exists, return its info
        if self.worktree_exists(task_id) {
            // Get the current commit of the task branch as the base commit
            let base_commit = self
                .get_commit_oid(Some(&branch_name))
                .map(|oid| oid.to_string())
                .unwrap_or_default();
            return Ok(WorktreeCreated {
                branch_name,
                worktree_path,
                base_commit,
            });
        }

        // Ensure worktrees directory exists
        std::fs::create_dir_all(&self.worktrees_dir)?;

        // Get the commit OID to branch from (releases lock)
        let commit_oid = self.get_commit_oid(base_branch)?;

        // Create the branch (acquires and releases lock)
        self.create_branch_from_oid(&branch_name, commit_oid)?;

        // Create the worktree (acquires and releases lock)
        self.create_worktree_for_branch(task_id, &branch_name, &worktree_path)?;

        Ok(WorktreeCreated {
            branch_name,
            worktree_path,
            base_commit: commit_oid.to_string(),
        })
    }

    fn run_setup_script(&self, worktree_path: &Path) -> Result<(), GitError> {
        self.run_worktree_setup(worktree_path)
    }

    fn worktree_exists(&self, task_id: &str) -> bool {
        let Ok(repo) = self.repo.lock() else {
            return false;
        };
        repo.find_worktree(task_id).is_ok()
    }

    fn remove_worktree(&self, task_id: &str, delete_branch: bool) -> Result<(), GitError> {
        let worktree_path = self.worktrees_dir.join(task_id);
        let branch_name = format!("task/{task_id}");

        // Prune the worktree from git
        {
            let repo = self
                .repo
                .lock()
                .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;
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
                // Branch may not exist - log but don't fail cleanup
                eprintln!("[git] WARNING: Failed to delete branch {branch_name}: {e}");
            }
        }

        Ok(())
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

    fn has_pending_changes(&self, worktree_path: &Path) -> Result<bool, GitError> {
        let output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git status: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::IoError(format!(
                "Failed to check pending changes in {}: {stderr}",
                worktree_path.display()
            )));
        }

        let status = String::from_utf8_lossy(&output.stdout);
        Ok(!status.trim().is_empty())
    }

    fn commit_pending_changes(&self, worktree_path: &Path, message: &str) -> Result<(), GitError> {
        if !self.has_pending_changes(worktree_path)? {
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

    fn rebase_on_branch(&self, worktree_path: &Path, target_branch: &str) -> Result<(), GitError> {
        // Resolve the task branch name for error reporting
        let branch_output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to get branch name: {e}")))?;

        if !branch_output.status.success() {
            let stderr = String::from_utf8_lossy(&branch_output.stderr);
            return Err(GitError::IoError(format!(
                "Failed to get branch name in {}: {stderr}",
                worktree_path.display()
            )));
        }

        let branch_name = String::from_utf8_lossy(&branch_output.stdout)
            .trim()
            .to_string();

        let rebase_output = Command::new("git")
            .args(["rebase", target_branch])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| GitError::MergeError(format!("Failed to run git rebase: {e}")))?;

        if !rebase_output.status.success() {
            // Check for conflict files in the worktree
            let conflict_output = Command::new("git")
                .args(["diff", "--name-only", "--diff-filter=U"])
                .current_dir(worktree_path)
                .output()
                .map_err(|e| GitError::IoError(format!("Failed to check conflicts: {e}")))?;

            let conflict_files: Vec<String> = String::from_utf8_lossy(&conflict_output.stdout)
                .lines()
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();

            // Abort the rebase to restore the branch to its original state
            let _ = Command::new("git")
                .args(["rebase", "--abort"])
                .current_dir(worktree_path)
                .output();

            if !conflict_files.is_empty() {
                return Err(GitError::MergeConflict {
                    branch: branch_name,
                    conflict_files,
                });
            }

            let stderr = String::from_utf8_lossy(&rebase_output.stderr);
            return Err(GitError::MergeError(format!(
                "Failed to rebase onto {target_branch}: {stderr}"
            )));
        }

        Ok(())
    }

    fn merge_to_branch(
        &self,
        branch_name: &str,
        target_branch: &str,
    ) -> Result<MergeResult, GitError> {
        let working_dir = self.resolve_branch_working_dir(target_branch)?;
        let was_stashed = Self::stash_changes(&working_dir)?;

        let merge_result = Self::fast_forward_merge(&working_dir, branch_name, target_branch);

        if let Err(e) = Self::stash_pop(&working_dir, was_stashed) {
            crate::orkestra_debug!("git", "WARNING: Failed to restore stashed changes: {}", e);
        }

        merge_result
    }

    fn delete_branch(&self, branch_name: &str) -> Result<(), GitError> {
        let repo = self
            .repo
            .lock()
            .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;

        // Find and delete the branch using git2 API
        // Using the same in-process repository handle avoids metadata inconsistency
        // that can occur when mixing git2 worktree operations with CLI branch deletion
        let mut branch = repo
            .find_branch(branch_name, git2::BranchType::Local)
            .map_err(|e| GitError::BranchError(format!("Failed to find branch: {e}")))?;

        branch
            .delete()
            .map_err(|e| GitError::BranchError(format!("Failed to delete branch: {e}")))?;

        Ok(())
    }

    fn list_worktree_names(&self) -> Result<Vec<String>, GitError> {
        let mut names = Vec::new();

        // Collect worktree directories on disk
        if self.worktrees_dir.exists() {
            let entries = std::fs::read_dir(&self.worktrees_dir)
                .map_err(|e| GitError::IoError(format!("Failed to read worktrees dir: {e}")))?;

            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        names.push(name.to_string());
                    }
                }
            }
        }

        // Also collect worktrees registered in git whose path is under our
        // worktrees_dir. This catches stale/prunable entries where the directory
        // was deleted but git metadata in .git/worktrees/ remains.
        if let Ok(repo) = self.repo.lock() {
            if let Ok(git_worktree_names) = repo.worktrees() {
                for i in 0..git_worktree_names.len() {
                    let Some(wt_name) = git_worktree_names.get(i) else {
                        continue;
                    };
                    if names.iter().any(|n| n == wt_name) {
                        continue; // Already found on disk
                    }
                    // Only include if this worktree belongs to us (path under worktrees_dir)
                    if let Ok(worktree) = repo.find_worktree(wt_name) {
                        if worktree.path().starts_with(&self.worktrees_dir) {
                            names.push(wt_name.to_string());
                        }
                    }
                }
            }
        }

        Ok(names)
    }

    fn is_branch_merged(&self, branch_name: &str, target_branch: &str) -> Result<bool, GitError> {
        // Check if the branch still exists
        let verify_output = Command::new("git")
            .args([
                "rev-parse",
                "--verify",
                &format!("refs/heads/{branch_name}"),
            ])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to check branch existence: {e}")))?;

        if !verify_output.status.success() {
            // Branch doesn't exist — it was already cleaned up after merge
            return Ok(true);
        }

        // Check if branch_name is an ancestor of target_branch
        // Exit code 0 = is ancestor (merged), 1 = not ancestor (not merged)
        let output = Command::new("git")
            .args(["merge-base", "--is-ancestor", branch_name, target_branch])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to check merge-base: {e}")))?;

        Ok(output.status.success())
    }

    fn diff_against_base(
        &self,
        worktree_path: &Path,
        branch_name: &str,
        base_branch: &str,
    ) -> Result<crate::workflow::ports::TaskDiff, GitError> {
        super::diff::execute_diff(worktree_path, branch_name, base_branch)
    }

    fn diff_uncommitted(
        &self,
        worktree_path: &Path,
    ) -> Result<crate::workflow::ports::TaskDiff, GitError> {
        super::diff::execute_uncommitted_diff(worktree_path)
    }

    fn read_file_at_head(
        &self,
        worktree_path: &Path,
        file_path: &str,
    ) -> Result<Option<String>, GitError> {
        super::diff::read_file_at_head(worktree_path, file_path)
    }

    fn commit_log(
        &self,
        limit: usize,
    ) -> Result<Vec<crate::workflow::ports::CommitInfo>, GitError> {
        // Use record separator (0x1e) between commits to handle multi-line bodies
        let output = Command::new("git")
            .args([
                "log",
                &format!("-{limit}"),
                "--format=%x1e%h%x00%s%x00%an%x00%aI%x00%b",
            ])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git log: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::IoError(format!("git log failed: {stderr}")));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut commits = Vec::new();

        // Split on record separator (0x1e) — each record is one commit
        for record in stdout.split('\x1e') {
            let record = record.trim();
            if record.is_empty() {
                continue;
            }
            let parts: Vec<&str> = record.splitn(5, '\0').collect();
            if parts.len() == 5 {
                let body_text = parts[4].trim();
                let body = if body_text.is_empty() {
                    None
                } else {
                    Some(body_text.to_string())
                };
                commits.push(crate::workflow::ports::CommitInfo {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    body,
                    author: parts[2].to_string(),
                    timestamp: parts[3].to_string(),
                    file_count: None,
                });
            } else {
                crate::orkestra_debug!(
                    "git",
                    "Skipping malformed commit record with {} fields (expected 5)",
                    parts.len()
                );
            }
        }

        Ok(commits)
    }

    fn batch_file_counts(
        &self,
        hashes: &[String],
    ) -> Result<std::collections::HashMap<String, usize>, GitError> {
        let mut counts = std::collections::HashMap::new();
        for hash in hashes {
            let output = Command::new("git")
                .args([
                    "diff-tree",
                    "--root",
                    "--no-commit-id",
                    "--name-only",
                    "-r",
                    hash,
                ])
                .current_dir(&self.repo_path)
                .output();

            let output = output.map_err(|e| GitError::IoError(format!("git diff-tree: {e}")))?;
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let count = stdout.lines().filter(|l| !l.is_empty()).count();
                counts.insert(hash.clone(), count);
            }
        }
        Ok(counts)
    }

    fn commit_diff(&self, commit_hash: &str) -> Result<crate::workflow::ports::TaskDiff, GitError> {
        // First, try the normal case (commit with parent)
        let output = Command::new("git")
            .args([
                "diff",
                &format!("{commit_hash}^..{commit_hash}"),
                "--unified=3",
                "--no-color",
                "--numstat",
                "--no-renames",
                "-p",
            ])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to run git diff for commit: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Handle initial commit (no parent) — use git show instead
            if stderr.contains("unknown revision") || stderr.contains("bad revision") {
                let fallback = Command::new("git")
                    .args([
                        "show",
                        "--unified=3",
                        "--no-color",
                        "--numstat",
                        "--no-renames",
                        "-p",
                        "--format=", // Empty format to suppress commit metadata
                        commit_hash,
                    ])
                    .current_dir(&self.repo_path)
                    .output()
                    .map_err(|e| {
                        GitError::IoError(format!("Failed to run git show for initial commit: {e}"))
                    })?;

                if !fallback.status.success() {
                    let fallback_stderr = String::from_utf8_lossy(&fallback.stderr);
                    return Err(GitError::IoError(format!(
                        "git show failed for initial commit: {fallback_stderr}"
                    )));
                }
                let stdout = String::from_utf8_lossy(&fallback.stdout);
                return Ok(super::diff::parse_diff_output(&stdout));
            }
            return Err(GitError::IoError(format!("git diff failed: {stderr}")));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(super::diff::parse_diff_output(&stdout))
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

        // Branch should be deleted (task/* branches are filtered from list_branches,
        // so we check directly with git)
        let output = Command::new("git")
            .args(["branch", "--list", "task/TASK-002"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to list branches");
        let branch_list = String::from_utf8_lossy(&output.stdout);
        assert!(
            !branch_list.contains("task/TASK-002"),
            "Branch should be deleted after cleanup"
        );
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
    fn test_merge_to_branch() {
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
            .merge_to_branch("task/TASK-005", "main")
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

    #[test]
    fn test_is_branch_merged_after_merge() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create worktree, commit, and merge
        let worktree = git
            .create_worktree("TASK-MERGED", None)
            .expect("Failed to create worktree");
        std::fs::write(worktree.worktree_path.join("merged.txt"), "content")
            .expect("Failed to write");
        git.commit_pending_changes(&worktree.worktree_path, "Add file")
            .expect("Failed to commit");
        git.merge_to_branch("task/TASK-MERGED", "main")
            .expect("Failed to merge");

        // Branch should be detected as merged
        assert!(
            git.is_branch_merged("task/TASK-MERGED", "main")
                .expect("Should check merge status"),
            "Branch should be merged after merge_to_branch"
        );
    }

    #[test]
    fn test_is_branch_not_merged() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create worktree and commit, but do NOT merge
        let worktree = git
            .create_worktree("TASK-UNMERGED", None)
            .expect("Failed to create worktree");
        std::fs::write(worktree.worktree_path.join("unmerged.txt"), "content")
            .expect("Failed to write");
        git.commit_pending_changes(&worktree.worktree_path, "Add file")
            .expect("Failed to commit");

        // Branch should NOT be detected as merged
        assert!(
            !git.is_branch_merged("task/TASK-UNMERGED", "main")
                .expect("Should check merge status"),
            "Branch should not be merged before merge_to_branch"
        );
    }

    #[test]
    fn test_is_branch_merged_deleted_branch() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // A branch that doesn't exist should be treated as "already merged"
        // (it was cleaned up after a successful merge)
        assert!(
            git.is_branch_merged("task/NONEXISTENT", "main")
                .expect("Should check merge status"),
            "Missing branch should be treated as already merged"
        );
    }

    #[test]
    fn test_full_workflow_cleanup_deletes_branch() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create worktree and add a commit
        let worktree = git
            .create_worktree("TASK-INTEGRATION", None)
            .expect("Failed to create worktree");

        std::fs::write(worktree.worktree_path.join("feature.txt"), "new feature")
            .expect("Failed to write file");

        git.commit_pending_changes(&worktree.worktree_path, "Add feature")
            .expect("Failed to commit");

        // Merge to main
        git.merge_to_branch("task/TASK-INTEGRATION", "main")
            .expect("Failed to merge");

        // Verify branch exists before cleanup
        let output = Command::new("git")
            .args(["branch", "--list", "task/TASK-INTEGRATION"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to list branches");
        let branch_list = String::from_utf8_lossy(&output.stdout);
        assert!(
            branch_list.contains("task/TASK-INTEGRATION"),
            "Branch should exist before cleanup"
        );

        // Remove worktree with branch deletion
        git.remove_worktree("TASK-INTEGRATION", true)
            .expect("Failed to remove worktree");

        // Verify worktree is gone
        assert!(!git.worktree_exists("TASK-INTEGRATION"));

        // Verify branch is deleted
        let output = Command::new("git")
            .args(["branch", "--list", "task/TASK-INTEGRATION"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to list branches");
        let branch_list = String::from_utf8_lossy(&output.stdout);
        assert!(
            !branch_list.contains("task/TASK-INTEGRATION"),
            "Branch should be deleted after cleanup"
        );

        // Verify the merged file still exists in main
        assert!(repo_path.join("feature.txt").exists());
    }

    #[test]
    fn test_commit_log_returns_recent_commits() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create two additional commits (we already have initial commit)
        std::fs::write(repo_path.join("file2.txt"), "second commit").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Second commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        std::fs::write(repo_path.join("file3.txt"), "third commit").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Third commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        // Get commit log
        let commits = git.commit_log(20).expect("Failed to get commit log");

        // Should have 3 commits (initial + 2 new ones)
        assert_eq!(commits.len(), 3, "Expected 3 commits");

        // Commits should be in newest-first order
        assert_eq!(commits[0].message, "Third commit");
        assert_eq!(commits[1].message, "Second commit");
        assert_eq!(commits[2].message, "Initial commit");

        // Check metadata
        assert_eq!(commits[0].author, "Test User");
        assert!(!commits[0].hash.is_empty());
        assert!(!commits[0].timestamp.is_empty());
        assert_eq!(
            commits[0].file_count, None,
            "File count should be None from commit_log"
        );
    }

    #[test]
    fn test_commit_log_parses_body_field() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create a commit with a multi-line message (subject + body)
        std::fs::write(repo_path.join("file2.txt"), "with body").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args([
                "commit",
                "-m",
                "Subject line",
                "-m",
                "This is the body paragraph.\n\nIt has multiple lines and blank lines.",
            ])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        // Create another commit with single-line message (no body)
        std::fs::write(repo_path.join("file3.txt"), "no body").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Single line only"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        // Get commit log
        let commits = git.commit_log(20).expect("Failed to get commit log");

        // Should have 3 commits (initial + 2 new ones)
        assert_eq!(commits.len(), 3, "Expected 3 commits");

        // Newest commit (single-line) should have None body
        assert_eq!(commits[0].message, "Single line only");
        assert_eq!(
            commits[0].body, None,
            "Single-line commit should have None body"
        );

        // Second commit (multi-line) should have Some(body)
        assert_eq!(commits[1].message, "Subject line");
        assert!(
            commits[1].body.is_some(),
            "Multi-line commit should have Some(body)"
        );
        let body = commits[1].body.as_ref().unwrap();
        assert!(
            body.contains("body paragraph"),
            "Body should contain expected text"
        );
        assert!(
            body.contains("multiple lines"),
            "Body should preserve content"
        );

        // Initial commit (single-line) should also have None body
        assert_eq!(commits[2].message, "Initial commit");
        assert_eq!(
            commits[2].body, None,
            "Initial commit should have None body"
        );
    }

    #[test]
    fn test_commit_log_respects_limit() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create 4 additional commits
        for i in 2..=5 {
            std::fs::write(
                repo_path.join(format!("file{i}.txt")),
                format!("commit {i}"),
            )
            .expect("Failed to write file");
            Command::new("git")
                .args(["add", "."])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to add");
            Command::new("git")
                .args(["commit", "-m", &format!("Commit {i}")])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to commit");
        }

        // Request only 2 commits
        let commits = git.commit_log(2).expect("Failed to get commit log");

        assert_eq!(commits.len(), 2, "Should only return 2 commits");
        assert_eq!(commits[0].message, "Commit 5");
        assert_eq!(commits[1].message, "Commit 4");
    }

    #[test]
    fn test_batch_file_counts() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create commits with different file counts
        // Commit with 1 file
        std::fs::write(repo_path.join("file2.txt"), "second commit").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Second commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        // Commit with 2 files
        std::fs::write(repo_path.join("file3.txt"), "third commit").expect("Failed to write file");
        std::fs::write(repo_path.join("file4.txt"), "third commit also")
            .expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Third commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        // Get all commits to extract hashes
        let commits = git.commit_log(10).expect("Failed to get commit log");
        let hashes: Vec<String> = commits.iter().map(|c| c.hash.clone()).collect();

        // Get file counts for all commits
        let counts = git
            .batch_file_counts(&hashes)
            .expect("Failed to get batch file counts");

        // Should have counts for all commits
        assert_eq!(counts.len(), 3, "Should have counts for 3 commits");

        // Verify counts (note: commits[0] is newest, commits[2] is oldest)
        assert_eq!(
            counts.get(&commits[0].hash),
            Some(&2),
            "Third commit should have 2 files"
        );
        assert_eq!(
            counts.get(&commits[1].hash),
            Some(&1),
            "Second commit should have 1 file"
        );
        assert_eq!(
            counts.get(&commits[2].hash),
            Some(&1),
            "Initial commit should have 1 file (--root flag handles root commits)"
        );
    }

    #[test]
    fn test_batch_file_counts_with_invalid_hash() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        let commits = git.commit_log(1).expect("Failed to get commit log");
        let mut hashes: Vec<String> = commits.iter().map(|c| c.hash.clone()).collect();
        hashes.push("invalid-hash-12345".to_string());

        let counts = git
            .batch_file_counts(&hashes)
            .expect("Failed to get batch file counts");

        // Should only have count for valid commit
        assert_eq!(counts.len(), 1, "Should only count valid commits");
        assert!(
            counts.contains_key(&commits[0].hash),
            "Should have count for valid commit"
        );
        assert!(
            !counts.contains_key("invalid-hash-12345"),
            "Should not have count for invalid hash"
        );
    }

    #[test]
    fn test_commit_diff_shows_changes() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create a commit that adds a file
        std::fs::write(repo_path.join("new_file.rs"), "fn main() {}\n")
            .expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Add new_file.rs"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        // Get the commit hash
        let output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to get HEAD");
        let commit_hash = String::from_utf8_lossy(&output.stdout).trim().to_string();

        // Get the diff for this commit
        let diff = git
            .commit_diff(&commit_hash)
            .expect("Failed to get commit diff");

        // Should have one file
        assert_eq!(diff.files.len(), 1, "Expected 1 file in diff");

        let file = &diff.files[0];
        assert_eq!(file.path, "new_file.rs");
        assert!(matches!(
            file.change_type,
            crate::workflow::ports::FileChangeType::Added
        ));
        assert_eq!(file.additions, 1);
        assert!(!file.is_binary);
        assert!(file.diff_content.is_some());
    }

    #[test]
    fn test_merge_to_branch_in_worktree() {
        let (_temp_dir, repo_path) = create_test_repo();
        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Create parent worktree (branched from main)
        let parent = git
            .create_worktree("PARENT", Some("main"))
            .expect("Failed to create parent worktree");

        // Add a commit to parent so child branches from it
        std::fs::write(parent.worktree_path.join("parent_file.txt"), "parent work")
            .expect("Failed to write parent file");
        git.commit_pending_changes(&parent.worktree_path, "Parent commit")
            .expect("Failed to commit in parent");

        // Create child worktree branched from parent
        let child = git
            .create_worktree("CHILD", Some("task/PARENT"))
            .expect("Failed to create child worktree");

        // Add a commit to child
        std::fs::write(child.worktree_path.join("child_file.txt"), "child work")
            .expect("Failed to write child file");
        git.commit_pending_changes(&child.worktree_path, "Child commit")
            .expect("Failed to commit in child");

        // Merge child → parent (target is a worktree branch)
        let result = git
            .merge_to_branch("task/CHILD", "task/PARENT")
            .expect("Failed to merge child into parent");

        assert_eq!(result.target_branch, "task/PARENT");
        assert!(!result.commit_sha.is_empty());

        // Verify the child's file now appears in the parent worktree
        assert!(
            parent.worktree_path.join("child_file.txt").exists(),
            "Child file should be visible in parent worktree after merge"
        );
    }

    #[test]
    fn test_commit_diff_initial_commit() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo_path = temp_dir.path().to_path_buf();

        // Initialize repo
        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to init");

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to configure email");

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to configure name");

        // Create initial commit
        std::fs::write(repo_path.join("initial.txt"), "Hello\n").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        // Get the commit hash
        let output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to get HEAD");
        let commit_hash = String::from_utf8_lossy(&output.stdout).trim().to_string();

        let git = Git2GitService::new(&repo_path).expect("Failed to create git service");

        // Get diff for initial commit (should use empty tree comparison)
        let diff = git
            .commit_diff(&commit_hash)
            .expect("Failed to get initial commit diff");

        assert_eq!(
            diff.files.len(),
            1,
            "Expected 1 file in initial commit diff"
        );
        let file = &diff.files[0];
        assert_eq!(file.path, "initial.txt");
        assert!(matches!(
            file.change_type,
            crate::workflow::ports::FileChangeType::Added
        ));
    }
}
