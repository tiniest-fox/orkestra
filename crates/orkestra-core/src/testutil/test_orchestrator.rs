//! Test orchestrator for full workflow testing.
//!
//! Provides a thin wrapper around [`Project`] that adds mock process spawning
//! for testing workflows without actually invoking Claude Code.

use crate::domain::Task;
use crate::error::Result;
use crate::services::Project;

use super::git_helpers::{create_orkestra_dirs, create_temp_git_repo};
use super::mock_spawner::MockProcessSpawner;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tempfile::TempDir;

/// Test orchestrator that wraps a real [`Project`] for workflow testing.
///
/// This provides high-level methods to simulate the complete task lifecycle
/// without actually spawning Claude Code processes, while still using
/// the real production code paths in [`Project`].
///
/// # Example
///
/// ```ignore
/// use orkestra_core::testutil::create_test_orchestrator;
///
/// let (orchestrator, _temp_dir) = create_test_orchestrator().unwrap();
///
/// // Create a task (uses real Project code)
/// let task = orchestrator.project.create_task("My feature", "Description").unwrap();
///
/// // Simulate planning
/// orchestrator.project.set_plan(&task.id, "1. Do X\n2. Do Y").unwrap();
/// orchestrator.project.approve_plan(&task.id).unwrap();
///
/// // Simulate worker making changes
/// orchestrator.simulate_worker_changes(&task.id, "Worker made changes").unwrap();
///
/// // Complete and merge (uses real integration code)
/// orchestrator.project.complete_task(&task.id, "Done!").unwrap();
/// let task = orchestrator.project.approve_review(&task.id).unwrap();
/// assert_eq!(task.status, TaskStatus::Done);
/// ```
pub struct TestOrchestrator {
    /// The real project (uses production code paths).
    pub project: Project,
    /// The mock process spawner (for inspection).
    pub spawner: Arc<MockProcessSpawner>,
    /// Path to the test repository.
    pub project_root: PathBuf,
}

impl TestOrchestrator {
    /// Create a new test orchestrator wrapping a project.
    pub fn new(project: Project, spawner: Arc<MockProcessSpawner>, project_root: PathBuf) -> Self {
        Self {
            project,
            spawner,
            project_root,
        }
    }

    /// Simulate worker making changes in the worktree.
    ///
    /// This creates a file and commits it in the task's worktree,
    /// simulating what a real worker agent would do.
    pub fn simulate_worker_changes(&self, task_id: &str, content: &str) -> Result<()> {
        let task = self
            .project
            .get_task(task_id)?
            .ok_or_else(|| crate::OrkestraError::TaskNotFound(task_id.to_string()))?;

        if let Some(worktree_path) = &task.worktree_path {
            let file_path = Path::new(worktree_path).join("changes.txt");
            std::fs::write(&file_path, content)?;

            Command::new("git")
                .args(["add", "."])
                .current_dir(worktree_path)
                .output()?;

            Command::new("git")
                .args(["commit", "-m", "Worker changes"])
                .current_dir(worktree_path)
                .output()?;
        }

        Ok(())
    }

    /// Simulate worker creating a file in the worktree.
    ///
    /// This just creates the file - the production code should handle
    /// committing before merge.
    pub fn simulate_worker_file_change(
        &self,
        task_id: &str,
        filename: &str,
        content: &str,
    ) -> Result<()> {
        let task = self
            .project
            .get_task(task_id)?
            .ok_or_else(|| crate::OrkestraError::TaskNotFound(task_id.to_string()))?;

        if let Some(worktree_path) = &task.worktree_path {
            std::fs::write(Path::new(worktree_path).join(filename), content)?;
        }

        Ok(())
    }

    /// Make changes directly on main branch (for conflict testing).
    pub fn make_main_branch_changes(
        &self,
        filename: &str,
        content: &str,
        commit_message: &str,
    ) -> Result<()> {
        std::fs::write(self.project_root.join(filename), content)?;

        Command::new("git")
            .args(["add", filename])
            .current_dir(&self.project_root)
            .output()?;

        Command::new("git")
            .args(["commit", "-m", commit_message])
            .current_dir(&self.project_root)
            .output()?;

        Ok(())
    }

    /// Run the full workflow: plan → approve → work → complete → integrate.
    ///
    /// This is a convenience method for simple test cases.
    pub fn run_full_workflow(
        &self,
        title: &str,
        description: &str,
        plan: &str,
        work_content: &str,
        summary: &str,
    ) -> Result<Task> {
        // Create task (this creates worktree)
        let task = self.project.create_task(title, description)?;

        // Skip breakdown for simplicity
        self.project.update_task(&task.id, |t| {
            t.skip_breakdown = true;
            Ok(())
        })?;

        // Plan phase
        self.project.set_plan(&task.id, plan)?;
        self.project.approve_plan(&task.id)?;

        // Work phase
        self.simulate_worker_changes(&task.id, work_content)?;
        self.project.complete_task(&task.id, summary)?;

        // Review/integrate phase
        self.project.approve_review(&task.id)
    }
}

/// Create a fully configured test orchestrator with a temp git repo.
///
/// This sets up everything needed for workflow testing:
/// - Temporary git repository
/// - Real [`Project`] initialized in the temp directory
/// - Mock process spawner (for inspection)
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
///
/// // Use real Project methods
/// let task = orchestrator.project.create_task("Title", "Desc").unwrap();
/// ```
pub fn create_test_orchestrator() -> std::io::Result<(TestOrchestrator, TempDir)> {
    let temp_dir = create_temp_git_repo()?;
    let project_root = temp_dir.path().to_path_buf();

    create_orkestra_dirs(&project_root)?;

    // Use the real Project::init()
    let project =
        Project::init(&project_root).map_err(|e| std::io::Error::other(e.to_string()))?;

    let spawner = Arc::new(MockProcessSpawner::new());

    let orchestrator = TestOrchestrator::new(project, spawner, project_root);

    Ok((orchestrator, temp_dir))
}
