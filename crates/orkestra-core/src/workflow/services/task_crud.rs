//! Task CRUD operations.

use std::sync::Arc;
use std::thread;

use crate::orkestra_debug;
use crate::title::generate_title_sync;
use crate::workflow::domain::{Iteration, Task};
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

use super::{workflow_warn, WorkflowApi};

impl WorkflowApi {
    /// Create a new task. Starts in the first workflow stage.
    ///
    /// Task creation returns immediately with `Phase::SettingUp`. A background thread
    /// handles worktree creation and setup script, then transitions to `Phase::Idle`
    /// (or `Status::Failed` if setup fails).
    ///
    /// If `title` is empty, a background thread will generate one using AI.
    ///
    /// The `base_branch` parameter specifies which branch to create the worktree from
    /// (defaults to current branch).
    pub fn create_task(
        &self,
        title: &str,
        description: &str,
        base_branch: Option<&str>,
    ) -> WorkflowResult<Task> {
        let id = self.store.next_task_id()?;
        let first_stage = self
            .workflow
            .first_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("No stages in workflow".into()))?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut task = Task::new(&id, title, description, &first_stage.name, &now);

        // ALWAYS start in SettingUp - async setup will transition to Idle
        task.phase = Phase::SettingUp;

        // Save task immediately (non-blocking UI)
        self.store.save_task(&task)?;

        // Create initial iteration
        let iteration = Iteration::new(format!("{}-iter-1", id), &id, &first_stage.name, 1, &now);
        self.store.save_iteration(&iteration)?;

        // ALWAYS spawn async setup (handles both git and no-git cases)
        spawn_async_setup(
            self.store.clone(),
            self.git_service.clone(),
            id.clone(),
            base_branch.map(String::from),
        );

        // If title is empty, generate one in the background
        if title.trim().is_empty() && !description.trim().is_empty() {
            spawn_title_generation(self.store.clone(), id.clone(), description.to_string());
        }

        orkestra_debug!(
            "task",
            "Created {}: phase={:?}, status={:?}, stage={}",
            task.id,
            task.phase,
            task.status,
            first_stage.name
        );

        Ok(task)
    }

    /// Create a new task with a parent (subtask).
    ///
    /// Subtasks inherit the parent's worktree rather than creating their own.
    /// They still go through `Phase::SettingUp` for consistency, but setup is instant.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the parent task is still in `SettingUp` phase.
    /// The parent's setup must complete before subtasks can be created.
    pub fn create_subtask(
        &self,
        parent_id: &str,
        title: &str,
        description: &str,
    ) -> WorkflowResult<Task> {
        // Verify parent exists and its setup is complete
        let parent = self.get_task(parent_id)?;

        if parent.phase == Phase::SettingUp {
            return Err(WorkflowError::InvalidTransition(
                "Cannot create subtask while parent task is still setting up".into(),
            ));
        }

        let id = self.store.next_task_id()?;
        let first_stage = self
            .workflow
            .first_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("No stages in workflow".into()))?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut task = Task::new(&id, title, description, &first_stage.name, &now);
        task.parent_id = Some(parent_id.to_string());

        // Subtasks inherit parent's worktree (no separate worktree needed)
        task.worktree_path = parent.worktree_path.clone();
        task.branch_name = parent.branch_name.clone();

        // Start in SettingUp for consistency with create_task()
        task.phase = Phase::SettingUp;

        self.store.save_task(&task)?;

        // Create initial iteration
        let iteration = Iteration::new(format!("{}-iter-1", id), &id, &first_stage.name, 1, &now);
        self.store.save_iteration(&iteration)?;

        // Spawn async setup - no git work needed, just transitions to Idle
        spawn_async_setup(self.store.clone(), None, id.clone(), None);

        orkestra_debug!(
            "task",
            "Created subtask {}: parent={}, phase={:?}",
            task.id,
            parent_id,
            task.phase
        );

        Ok(task)
    }

    /// Get a task by ID.
    pub fn get_task(&self, id: &str) -> WorkflowResult<Task> {
        self.store
            .get_task(id)?
            .ok_or_else(|| WorkflowError::TaskNotFound(id.into()))
    }

    /// List all active top-level tasks (excluding archived, without parents).
    pub fn list_tasks(&self) -> WorkflowResult<Vec<Task>> {
        let all_tasks = self.store.list_active_tasks()?;
        Ok(all_tasks
            .into_iter()
            .filter(|t| t.parent_id.is_none())
            .collect())
    }

    /// List all archived top-level tasks (tasks without parents).
    pub fn list_archived_tasks(&self) -> WorkflowResult<Vec<Task>> {
        let all_tasks = self.store.list_archived_tasks()?;
        Ok(all_tasks
            .into_iter()
            .filter(|t| t.parent_id.is_none())
            .collect())
    }

    /// List subtasks of a parent task.
    pub fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>> {
        self.store.list_subtasks(parent_id)
    }

    /// Delete a task, its subtasks, and all associated data.
    ///
    /// If git service is configured and the task has a worktree, it will be cleaned up
    /// along with its branch. Subtasks are deleted recursively (they inherit the parent's
    /// worktree so no additional worktree cleanup is needed for them).
    pub fn delete_task(&self, id: &str) -> WorkflowResult<()> {
        // Verify task exists and get worktree info
        let task = self.get_task(id)?;

        // Recursively delete subtasks first (they inherit parent's worktree)
        let subtasks = self.store.list_subtasks(id)?;
        for subtask in subtasks {
            self.delete_subtask_data(&subtask.id)?;
        }

        // Clean up git worktree and branch if present (only parent tasks have worktrees)
        if let Some(git) = &self.git_service {
            if task.worktree_path.is_some() {
                if let Err(e) = git.remove_worktree(id, true) {
                    workflow_warn!("Failed to remove worktree for {}: {}", id, e);
                }
            }
        }

        // Delete associated data
        self.store.delete_stage_sessions(id)?;
        self.store.delete_iterations(id)?;

        // Delete task
        self.store.delete_task(id)
    }

    /// Delete subtask data without worktree cleanup (subtasks share parent's worktree).
    fn delete_subtask_data(&self, id: &str) -> WorkflowResult<()> {
        // Recursively delete nested subtasks (if any)
        let subtasks = self.store.list_subtasks(id)?;
        for subtask in subtasks {
            self.delete_subtask_data(&subtask.id)?;
        }

        // Delete associated data
        self.store.delete_stage_sessions(id)?;
        self.store.delete_iterations(id)?;

        // Delete subtask
        self.store.delete_task(id)
    }
}

/// Spawn a background thread to generate a title for a task.
fn spawn_title_generation(store: Arc<dyn WorkflowStore>, task_id: String, description: String) {
    thread::spawn(move || {
        // Generate title with 30 second timeout
        match generate_title_sync(&description, 30) {
            Ok(title) => {
                // Update the task with the generated title
                if let Ok(Some(mut task)) = store.get_task(&task_id) {
                    if task.title.trim().is_empty() {
                        task.title = title;
                        if let Err(e) = store.save_task(&task) {
                            eprintln!("[orkestra] ERROR: Failed to save generated title for {task_id}: {e}");
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[orkestra] WARNING: Failed to generate title for {task_id}: {e}");
            }
        }
    });
}

/// Spawn a background thread to set up the task (worktree creation, setup script).
///
/// On success, transitions task to `Phase::Idle`.
/// On failure, transitions task to `Status::Failed` with error message.
fn spawn_async_setup(
    store: Arc<dyn WorkflowStore>,
    git: Option<Arc<dyn GitService>>,
    task_id: String,
    base_branch: Option<String>,
) {
    crate::orkestra_debug!("task", "spawn_async_setup {}: starting", task_id);
    thread::spawn(move || {
        // Attempt worktree creation if git is configured
        let result = if let Some(ref git) = git {
            match git.create_worktree(&task_id, base_branch.as_deref()) {
                Ok(result) => Ok(Some(result)),
                Err(e) => Err(format!("Worktree setup failed: {e}")),
            }
        } else {
            // No git configured - just mark setup complete
            Ok(None)
        };

        // Update task based on result
        match store.get_task(&task_id) {
            Ok(Some(mut task)) => {
                match result {
                    Ok(worktree_result) => {
                        // Success - update worktree info and transition to Idle
                        if let Some(ref wt) = worktree_result {
                            task.branch_name = Some(wt.branch_name.clone());
                            task.worktree_path =
                                Some(wt.worktree_path.to_string_lossy().to_string());
                        }
                        task.phase = Phase::Idle;
                        crate::orkestra_debug!(
                            "task",
                            "{} setup complete: phase=Idle, worktree={:?}, branch={:?}",
                            task_id,
                            task.worktree_path,
                            task.branch_name
                        );
                        if let Err(e) = store.save_task(&task) {
                            eprintln!("[setup] CRITICAL: Failed to save task {task_id}: {e}");
                        }
                    }
                    Err(error) => {
                        // FAIL the task visibly - no silent failures
                        eprintln!("[setup] Setup failed for {task_id}: {error}");
                        crate::orkestra_debug!("task", "{} setup failed: {}", task_id, error);
                        task.status = Status::Failed { error: Some(error) };
                        task.phase = Phase::Idle;
                        if let Err(e) = store.save_task(&task) {
                            eprintln!(
                                "[setup] CRITICAL: Failed to save failed task {task_id}: {e}"
                            );
                        }
                    }
                }
            }
            Ok(None) => {
                // Task was deleted during setup - clean up any orphaned worktree
                eprintln!("[setup] CRITICAL: Task {task_id} disappeared during setup");
                if let Some(ref git) = git {
                    if let Err(e) = git.remove_worktree(&task_id, true) {
                        eprintln!("[setup] WARNING: Failed to clean up orphaned worktree for {task_id}: {e}");
                    }
                }
            }
            Err(e) => {
                eprintln!("[setup] CRITICAL: Failed to load task {task_id}: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

    use super::*;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
        ])
    }

    #[test]
    fn test_create_task() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api
            .create_task("Fix bug", "Fix the login bug", None)
            .unwrap();

        assert_eq!(task.title, "Fix bug");
        assert_eq!(task.description, "Fix the login bug");
        assert_eq!(task.current_stage(), Some("planning"));
        assert!(task.parent_id.is_none());
    }

    /// Wait for a task's async setup to complete (bounded polling).
    fn wait_for_setup(api: &WorkflowApi, task_id: &str) -> Task {
        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            let task = api.get_task(task_id).unwrap();
            if task.phase != Phase::SettingUp {
                return task;
            }
        }
        panic!("Task setup did not complete in 1 second");
    }

    #[test]
    fn test_create_subtask() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task", None).unwrap();

        // Wait for parent setup to complete
        let parent = wait_for_setup(&api, &parent.id);

        let subtask = api
            .create_subtask(&parent.id, "Child", "Child task")
            .unwrap();

        assert_eq!(subtask.parent_id, Some(parent.id.clone()));
    }

    #[test]
    fn test_create_subtask_rejects_setting_up_parent() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task", None).unwrap();

        // Immediately try to create subtask - parent should still be in SettingUp
        let result = api.create_subtask(&parent.id, "Child", "Child task");
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_get_task() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        let fetched = api.get_task(&task.id).unwrap();

        assert_eq!(fetched.id, task.id);
        assert_eq!(fetched.title, "Test");
    }

    #[test]
    fn test_get_task_not_found() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let result = api.get_task("nonexistent");
        assert!(matches!(result, Err(WorkflowError::TaskNotFound(_))));
    }

    #[test]
    fn test_list_tasks_excludes_subtasks() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task", None).unwrap();

        // Wait for parent setup to complete
        let parent = wait_for_setup(&api, &parent.id);

        let _ = api
            .create_subtask(&parent.id, "Child", "Child task")
            .unwrap();
        let task2 = api.create_task("Task 2", "Second task", None).unwrap();

        let tasks = api.list_tasks().unwrap();
        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().any(|t| t.id == parent.id));
        assert!(tasks.iter().any(|t| t.id == task2.id));
    }

    #[test]
    fn test_list_subtasks() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task", None).unwrap();

        // Wait for parent setup to complete
        let parent = wait_for_setup(&api, &parent.id);

        let child1 = api.create_subtask(&parent.id, "Child 1", "First").unwrap();
        let child2 = api.create_subtask(&parent.id, "Child 2", "Second").unwrap();

        let subtasks = api.list_subtasks(&parent.id).unwrap();
        assert_eq!(subtasks.len(), 2);
        assert!(subtasks.iter().any(|t| t.id == child1.id));
        assert!(subtasks.iter().any(|t| t.id == child2.id));
    }

    #[test]
    fn test_delete_task() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        api.delete_task(&task.id).unwrap();

        let result = api.get_task(&task.id);
        assert!(matches!(result, Err(WorkflowError::TaskNotFound(_))));
    }

    #[test]
    fn test_create_task_creates_iteration() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        let iterations = api.get_iterations(&task.id).unwrap();

        assert_eq!(iterations.len(), 1);
        assert_eq!(iterations[0].stage, "planning");
        assert_eq!(iterations[0].iteration_number, 1);
    }

    #[test]
    fn test_list_tasks_excludes_archived() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task1 = api.create_task("Active", "Active task", None).unwrap();
        let mut task2 = api
            .create_task("Archived", "Will be archived", None)
            .unwrap();

        // Archive task2
        task2.status = Status::Archived;
        api.store.save_task(&task2).unwrap();

        let tasks = api.list_tasks().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, task1.id);
    }

    #[test]
    fn test_list_archived_tasks() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let _task1 = api.create_task("Active", "Active task", None).unwrap();
        let mut task2 = api
            .create_task("Archived", "Will be archived", None)
            .unwrap();

        // Archive task2
        task2.status = Status::Archived;
        api.store.save_task(&task2).unwrap();

        let archived = api.list_archived_tasks().unwrap();
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].id, task2.id);
        assert!(archived[0].is_archived());
    }
}
