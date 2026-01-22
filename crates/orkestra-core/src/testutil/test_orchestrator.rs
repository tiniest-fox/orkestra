//! Test orchestrator for full workflow testing.

use crate::adapters::FixedClock;
use crate::domain::{IntegrationResult, Task, TaskStatus};
use crate::error::Result;
use crate::ports::Clock;
use crate::ports::TaskStore;
use crate::services::{GitService, TaskService};
use crate::OrkestraError;

use super::git_helpers::{create_orkestra_dirs, create_temp_git_repo};
use super::mock_spawner::MockProcessSpawner;
use super::mock_store::MockStore;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tempfile::TempDir;

/// Test orchestrator that combines services for full workflow testing.
///
/// Provides high-level methods to simulate the complete task lifecycle
/// without actually spawning Claude Code processes.
///
/// # Example
///
/// ```ignore
/// use orkestra_core::testutil::create_test_orchestrator;
///
/// let (orchestrator, _temp_dir) = create_test_orchestrator().unwrap();
///
/// // Create a task with worktree
/// let task = orchestrator
///     .create_task_with_worktree("My feature", "Description")
///     .unwrap();
///
/// // Simulate planning
/// orchestrator.simulate_planner_complete(&task.id, "1. Do X\n2. Do Y").unwrap();
/// orchestrator.task_service.approve_plan(&task.id).unwrap();
///
/// // Simulate worker
/// orchestrator.simulate_worker_complete(&task.id, "Done!").unwrap();
///
/// // Complete and merge
/// let task = orchestrator.complete_and_integrate(&task.id).unwrap();
/// assert_eq!(task.status, TaskStatus::Done);
/// ```
pub struct TestOrchestrator<S: TaskStore, C: Clock> {
    /// The task service for managing task state.
    pub task_service: TaskService<S, C>,
    /// The git service for worktree operations.
    pub git_service: GitService,
    /// The mock process spawner (for inspection).
    pub spawner: Arc<MockProcessSpawner>,
    /// Path to the test repository.
    pub project_root: PathBuf,
}

impl<S: TaskStore, C: Clock> TestOrchestrator<S, C> {
    /// Create a new test orchestrator.
    pub fn new(
        task_service: TaskService<S, C>,
        git_service: GitService,
        spawner: Arc<MockProcessSpawner>,
        project_root: PathBuf,
    ) -> Self {
        Self {
            task_service,
            git_service,
            spawner,
            project_root,
        }
    }

    /// Create a task with an associated git worktree.
    ///
    /// This simulates what the real task creation does:
    /// 1. Creates the task via TaskService
    /// 2. Creates a branch and worktree via GitService
    /// 3. Updates the task with branch/worktree info
    pub fn create_task_with_worktree(&self, title: &str, description: &str) -> Result<Task> {
        let mut task = self.task_service.create(title, description, false)?;

        // Create worktree for root task
        let (branch_name, worktree_path) = self.git_service.create_worktree(&task.id)?;
        task.branch_name = Some(branch_name);
        task.worktree_path = Some(worktree_path.to_string_lossy().to_string());
        task.skip_breakdown = true;

        self.task_service.update(&task.id, |t| {
            t.branch_name = task.branch_name.clone();
            t.worktree_path = task.worktree_path.clone();
            t.skip_breakdown = true;
            Ok(())
        })?;

        Ok(task)
    }

    /// Simulate planner agent completing its work by setting a plan.
    pub fn simulate_planner_complete(&self, task_id: &str, plan: &str) -> Result<Task> {
        self.task_service.set_plan(task_id, plan)
    }

    /// Simulate worker agent completing its work.
    ///
    /// This also creates a commit in the worktree to simulate real work.
    pub fn simulate_worker_complete(&self, task_id: &str, summary: &str) -> Result<Task> {
        let task = self.task_service.get(task_id)?;

        // Simulate making changes in the worktree
        if let Some(worktree_path) = &task.worktree_path {
            let file_path = Path::new(worktree_path).join("changes.txt");
            std::fs::write(&file_path, "Worker made changes\n")?;

            Command::new("git")
                .args(["add", "."])
                .current_dir(worktree_path)
                .output()?;

            Command::new("git")
                .args(["commit", "-m", "Worker changes"])
                .current_dir(worktree_path)
                .output()?;
        }

        self.task_service.complete(task_id, summary)
    }

    /// Simulate worker making specific file changes (for conflict testing).
    pub fn simulate_worker_file_change(
        &self,
        task_id: &str,
        filename: &str,
        content: &str,
        commit_message: &str,
    ) -> Result<()> {
        let task = self.task_service.get(task_id)?;

        if let Some(worktree_path) = &task.worktree_path {
            std::fs::write(Path::new(worktree_path).join(filename), content)?;

            Command::new("git")
                .args(["add", filename])
                .current_dir(worktree_path)
                .output()?;

            Command::new("git")
                .args(["commit", "-m", commit_message])
                .current_dir(worktree_path)
                .output()?;
        }

        Ok(())
    }

    /// Complete the task and attempt to integrate (merge) back to main.
    ///
    /// This simulates the full completion flow:
    /// - For root tasks with worktrees: attempts merge to primary branch
    /// - On success: cleans up worktree and branch
    /// - On conflict: reopens task with conflict info
    /// - For child tasks or tasks without worktrees: skips integration
    pub fn complete_and_integrate(&self, task_id: &str) -> Result<Task> {
        let task = self.task_service.get(task_id)?;

        // Skip integration for non-root tasks or tasks without worktrees
        if task.parent_id.is_some() || task.branch_name.is_none() {
            self.task_service.update(task_id, |t| {
                t.status = TaskStatus::Done;
                t.integration_result = Some(IntegrationResult::Skipped {
                    reason: "Not a root task with worktree".into(),
                });
                Ok(())
            })?;
            return self.task_service.get(task_id);
        }

        let branch_name = task.branch_name.as_ref().unwrap().clone();

        match self.git_service.merge_to_primary(&branch_name) {
            Ok(commit_sha) => {
                // Success: cleanup worktree and branch
                let _ = self.git_service.remove_worktree(&task.id);
                let _ = self.git_service.delete_branch(&branch_name);

                let target_branch = self
                    .git_service
                    .detect_primary_branch()
                    .unwrap_or_else(|_| "main".into());

                self.task_service.update(task_id, |t| {
                    t.status = TaskStatus::Done;
                    t.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    t.integration_result = Some(IntegrationResult::Merged {
                        merged_at: chrono::Utc::now().to_rfc3339(),
                        commit_sha: commit_sha.clone(),
                        target_branch,
                    });
                    Ok(())
                })?;
            }
            Err(OrkestraError::MergeConflict { files, .. }) => {
                // Conflict: abort merge, reopen task
                let _ = self.git_service.abort_merge();

                self.task_service.update(task_id, |t| {
                    t.status = TaskStatus::Working;
                    t.summary = None;
                    t.reviewer_feedback = Some(format!("Merge conflict: {files:?}"));
                    t.integration_result = Some(IntegrationResult::Conflict {
                        conflict_files: files,
                    });
                    Ok(())
                })?;
            }
            Err(e) => {
                // Other error: skip integration
                self.task_service.update(task_id, |t| {
                    t.status = TaskStatus::Done;
                    t.integration_result = Some(IntegrationResult::Skipped {
                        reason: format!("Merge failed: {e}"),
                    });
                    Ok(())
                })?;
            }
        }

        self.task_service.get(task_id)
    }
}

/// Create a fully configured test orchestrator with a temp git repo.
///
/// This is a convenience function that sets up everything needed for
/// workflow testing:
/// - Temporary git repository
/// - Mock store and spawner
/// - Fixed clock
/// - All services wired together
///
/// Returns the orchestrator and temp directory (keep the TempDir alive
/// for the duration of the test).
///
/// # Example
///
/// ```ignore
/// use orkestra_core::testutil::create_test_orchestrator;
///
/// let (orchestrator, _temp_dir) = create_test_orchestrator().unwrap();
/// // _temp_dir must stay in scope for the test to work
/// ```
pub fn create_test_orchestrator(
) -> std::io::Result<(TestOrchestrator<MockStore, FixedClock>, TempDir)> {
    let temp_dir = create_temp_git_repo()?;
    let project_root = temp_dir.path().to_path_buf();

    create_orkestra_dirs(&project_root)?;

    let store = MockStore::new();
    let clock = FixedClock("2025-01-21T12:00:00Z".to_string());
    let task_service = TaskService::new(store, clock);
    let git_service =
        GitService::new(&project_root).map_err(|e| std::io::Error::other(e.to_string()))?;
    let spawner = Arc::new(MockProcessSpawner::new());

    let orchestrator = TestOrchestrator::new(task_service, git_service, spawner, project_root);

    Ok((orchestrator, temp_dir))
}
