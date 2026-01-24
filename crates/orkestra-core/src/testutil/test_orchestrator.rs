//! Test orchestrator for full workflow testing.
//!
//! Provides utilities for testing the complete task workflow using the exact
//! same code paths as production:
//! - UI actions use `tasks::` module functions (same as Tauri)
//! - Agent actions run the actual CLI binary (same as Claude Code)

use crate::error::Result;
use crate::services::Project;
use crate::tasks;

use super::git_helpers::{create_orkestra_dirs, create_temp_git_repo};

use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

/// Test orchestrator that uses the exact same code paths as production.
///
/// - UI actions (create task, approve plan, etc.) use `tasks::` functions (what Tauri uses)
/// - Agent actions (set plan, complete task, etc.) run the actual CLI (what Claude Code uses)
///
/// # Example
///
/// ```ignore
/// use orkestra_core::testutil::create_test_orchestrator;
/// use orkestra_core::tasks;
///
/// let (orchestrator, _temp_dir) = create_test_orchestrator().unwrap();
///
/// // UI creates task (uses tasks:: functions like Tauri)
/// let task = tasks::create_task(&orchestrator.project, "My feature", "Description").unwrap();
///
/// // Agent sets plan (runs actual CLI like Claude Code would)
/// orchestrator.run_cli_in_worktree(&task.id, &["task", "set-plan", &task.id, "--plan", "1. Do X"]).unwrap();
///
/// // UI approves plan (uses tasks:: functions like Tauri)
/// tasks::approve_task_plan(&orchestrator.project, &task.id).unwrap();
///
/// // Agent makes changes and completes (runs actual CLI)
/// orchestrator.simulate_worker_file_change(&task.id, "feature.rs", "pub fn x() {}").unwrap();
/// orchestrator.run_cli_in_worktree(&task.id, &["task", "complete", &task.id, "--summary", "Done"]).unwrap();
///
/// // UI starts automated review (uses tasks:: functions like Tauri)
/// tasks::start_automated_review(&orchestrator.project, &task.id).unwrap();
///
/// // Reviewer agent approves (runs actual CLI like reviewer Claude Code would)
/// orchestrator.run_cli_in_worktree(&task.id, &["task", "approve-review", &task.id]).unwrap();
/// ```
pub struct TestOrchestrator {
    /// The real project (provides store and git access).
    pub project: Project,
    /// Path to the test repository (main worktree).
    pub project_root: PathBuf,
    /// Path to the CLI binary.
    cli_binary: PathBuf,
}

impl TestOrchestrator {
    /// Create a new test orchestrator.
    pub fn new(project: Project, project_root: PathBuf, cli_binary: PathBuf) -> Self {
        Self {
            project,
            project_root,
            cli_binary,
        }
    }

    /// Run the CLI binary with the given arguments, from the task's worktree.
    ///
    /// This simulates what Claude Code agents do - they run `ork` commands
    /// from within the task's worktree directory.
    pub fn run_cli_in_worktree(&self, task_id: &str, args: &[&str]) -> Result<String> {
        let task = tasks::get_task(&self.project, task_id)?
            .ok_or_else(|| crate::OrkestraError::TaskNotFound(task_id.to_string()))?;

        let worktree_path = task
            .worktree_path
            .as_ref()
            .ok_or_else(|| crate::OrkestraError::InvalidInput("Task has no worktree".into()))?;

        let output = Command::new(&self.cli_binary)
            .args(args)
            .current_dir(worktree_path)
            .output()
            .map_err(crate::OrkestraError::Io)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(crate::OrkestraError::InvalidInput(format!(
                "CLI command failed: {}\nstdout: {}\nstderr: {}",
                args.join(" "),
                stdout,
                stderr
            )));
        }

        // Force a WAL checkpoint to ensure CLI changes are visible to our connection
        self.project.store().checkpoint()?;

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Run the CLI binary from the main project root (not a worktree).
    ///
    /// Useful for operations that don't require being in a worktree.
    pub fn run_cli(&self, args: &[&str]) -> Result<String> {
        let output = Command::new(&self.cli_binary)
            .args(args)
            .current_dir(&self.project_root)
            .output()
            .map_err(crate::OrkestraError::Io)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(crate::OrkestraError::InvalidInput(format!(
                "CLI command failed: {}\nstdout: {}\nstderr: {}",
                args.join(" "),
                stdout,
                stderr
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Simulate a worker creating/modifying a file in the worktree.
    ///
    /// This just creates the file - the production code will commit
    /// pending changes before merge.
    pub fn simulate_worker_file_change(
        &self,
        task_id: &str,
        filename: &str,
        content: &str,
    ) -> Result<()> {
        let task = tasks::get_task(&self.project, task_id)?
            .ok_or_else(|| crate::OrkestraError::TaskNotFound(task_id.to_string()))?;

        let worktree_path = task
            .worktree_path
            .as_ref()
            .ok_or_else(|| crate::OrkestraError::InvalidInput("Task has no worktree".into()))?;

        std::fs::write(Path::new(worktree_path).join(filename), content)?;
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

    /// Run the full workflow using realistic code paths:
    /// 1. UI creates task (`tasks::` function)
    /// 2. Agent sets plan (CLI command)
    /// 3. UI approves plan (`tasks::` function)
    /// 4. Agent makes changes and completes (CLI command)
    /// 5. UI starts automated review (`tasks::` function)
    /// 6. Reviewer agent approves (CLI command)
    pub fn run_full_workflow(
        &self,
        title: &str,
        description: &str,
        plan: &str,
        work_content: &str,
        summary: &str,
    ) -> Result<crate::Task> {
        // Step 1: UI creates task (what Tauri does)
        let task =
            tasks::create_task_with_options(&self.project, Some(title), description, false, None)?;

        // Set skip_breakdown for simpler flow
        self.project
            .store()
            .update_field(&task.id, "skip_breakdown", Some("1"))?;

        // Step 2: Agent sets plan (what Claude Code does - run actual CLI)
        self.run_cli_in_worktree(&task.id, &["task", "set-plan", &task.id, "--plan", plan])?;

        // Step 3: UI approves plan (what Tauri does)
        tasks::approve_task_plan(&self.project, &task.id)?;

        // Step 4: Agent makes changes in worktree
        self.simulate_worker_file_change(&task.id, "implementation.txt", work_content)?;

        // Step 5: Agent completes task (what Claude Code does - run actual CLI)
        self.run_cli_in_worktree(
            &task.id,
            &["task", "complete", &task.id, "--summary", summary],
        )?;

        // Step 6: UI starts automated review (what Tauri does)
        tasks::start_automated_review(&self.project, &task.id)?;

        // Step 7: Reviewer agent approves (what reviewer Claude Code does - run actual CLI)
        // This now just sets status to Done
        self.run_cli_in_worktree(&task.id, &["task", "approve-review", &task.id])?;

        // Step 8: Orchestrator integrates the done task (merge branch, cleanup, delete from DB)
        tasks::integrate_done_task(&self.project, &task.id)?;

        // Return the final task state - task is deleted after successful merge
        // so we return a synthetic Done task for the caller's assertions
        Ok(crate::Task {
            id: task.id,
            title: Some(title.to_string()),
            description: description.to_string(),
            status: crate::TaskStatus::Done,
            phase: crate::TaskPhase::Idle,
            kind: crate::TaskKind::Task,
            created_at: task.created_at,
            updated_at: chrono::Utc::now().to_rfc3339(),
            completed_at: Some(chrono::Utc::now().to_rfc3339()),
            summary: Some(summary.to_string()),
            error: None,
            plan: Some(plan.to_string()),
            pending_questions: Vec::new(),
            question_history: Vec::new(),
            auto_approve: false,
            parent_id: None,
            sessions: None,
            breakdown: None,
            skip_breakdown: true,
            agent_pid: None,
            branch_name: task.branch_name,
            worktree_path: None, // Cleaned up after merge
                                 // Note: integration_result now tracked in WorkLoop outcomes
            depends_on: Vec::new(),
            work_items: Vec::new(),
            assigned_worker_task_id: None,
        })
    }
}

/// Find the CLI binary path.
///
/// In tests, the binary is built to `target/debug/ork` (or release).
/// We find it relative to the workspace root.
fn find_cli_binary() -> std::io::Result<PathBuf> {
    // Get the workspace root from CARGO_MANIFEST_DIR
    // For orkestra-core, that's crates/orkestra-core, so we go up twice
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| std::io::Error::other("Cannot find workspace root"))?;

    // Check debug first, then release
    let debug_binary = workspace_root.join("target/debug/ork");
    if debug_binary.exists() {
        return Ok(debug_binary);
    }

    let release_binary = workspace_root.join("target/release/ork");
    if release_binary.exists() {
        return Ok(release_binary);
    }

    // Try to build it
    let status = Command::new("cargo")
        .args(["build", "-p", "orkestra-cli"])
        .current_dir(workspace_root)
        .status()?;

    if !status.success() {
        return Err(std::io::Error::other("Failed to build CLI binary"));
    }

    if debug_binary.exists() {
        Ok(debug_binary)
    } else {
        Err(std::io::Error::other(
            "CLI binary not found after build. Expected at target/debug/ork",
        ))
    }
}

/// Create a fully configured test orchestrator with a temp git repo.
///
/// This sets up everything needed for workflow testing:
/// - Temporary git repository
/// - Real [`Project`] initialized in the temp directory
/// - Path to CLI binary for running agent commands
///
/// Returns the orchestrator and temp directory (keep the `TempDir` alive
/// for the duration of the test).
///
/// # Example
///
/// ```ignore
/// use orkestra_core::testutil::create_test_orchestrator;
/// use orkestra_core::tasks;
///
/// let (orchestrator, _temp_dir) = create_test_orchestrator().unwrap();
///
/// // UI creates task
/// let task = tasks::create_task(&orchestrator.project, "Title", "Desc").unwrap();
///
/// // Agent sets plan via CLI
/// orchestrator.run_cli_in_worktree(&task.id, &["task", "set-plan", &task.id, "--plan", "..."]).unwrap();
/// ```
pub fn create_test_orchestrator() -> std::io::Result<(TestOrchestrator, TempDir)> {
    let cli_binary = find_cli_binary()?;
    let temp_dir = create_temp_git_repo()?;
    let project_root = temp_dir.path().to_path_buf();

    create_orkestra_dirs(&project_root)?;

    // Use the real Project::init()
    let project = Project::init(&project_root).map_err(|e| std::io::Error::other(e.to_string()))?;

    let orchestrator = TestOrchestrator::new(project, project_root, cli_binary);

    Ok((orchestrator, temp_dir))
}
