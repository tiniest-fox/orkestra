//! Task CRUD operations.

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::Phase;

use super::WorkflowApi;

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
        self.create_task_with_options(title, description, base_branch, false, None)
    }

    /// Create a new task with options. Starts in the first workflow stage.
    ///
    /// Like `create_task`, but allows setting `auto_mode` and `flow` at creation time.
    /// When `flow` is specified, the task starts at the first stage of that flow.
    pub fn create_task_with_options(
        &self,
        title: &str,
        description: &str,
        base_branch: Option<&str>,
        auto_mode: bool,
        flow: Option<&str>,
    ) -> WorkflowResult<Task> {
        // Validate flow exists if specified
        if let Some(flow_name) = flow {
            if !self.workflow.flows.contains_key(flow_name) {
                return Err(WorkflowError::InvalidTransition(format!(
                    "Unknown flow \"{flow_name}\". Available flows: {:?}",
                    self.workflow.flows.keys().collect::<Vec<_>>()
                )));
            }
        }

        let id = self.store.next_task_id()?;
        let first_stage = self
            .workflow
            .first_stage_in_flow(flow)
            .ok_or_else(|| WorkflowError::InvalidTransition("No stages in workflow".into()))?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut task = Task::new(&id, title, description, &first_stage.name, &now);
        task.auto_mode = auto_mode;
        task.flow = flow.map(String::from);

        // ALWAYS start in SettingUp - async setup will transition to Idle
        task.phase = Phase::SettingUp;

        // Save task immediately (non-blocking UI)
        self.store.save_task(&task)?;

        // Create initial iteration via IterationService
        self.iteration_service
            .create_initial_iteration(&id, &first_stage.name)?;

        // Spawn async setup (handles worktree creation and title generation in parallel)
        let needs_title = title.trim().is_empty() && !description.trim().is_empty();
        self.setup_service.spawn_setup(
            id.clone(),
            base_branch.map(String::from),
            if needs_title {
                Some(description.to_string())
            } else {
                None
            },
        );

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
        task.worktree_path.clone_from(&parent.worktree_path);
        task.branch_name.clone_from(&parent.branch_name);

        // Subtasks inherit parent's auto_mode
        task.auto_mode = parent.auto_mode;

        // Start in SettingUp for consistency with create_task()
        task.phase = Phase::SettingUp;

        self.store.save_task(&task)?;

        // Create initial iteration via IterationService
        self.iteration_service
            .create_initial_iteration(&id, &first_stage.name)?;

        // Spawn async setup - no git work needed, just transitions to Idle
        self.setup_service.spawn_subtask_setup(id.clone());

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
    /// Deletes all DB records (task, subtasks, iterations, stage sessions) in a
    /// single transaction. Git worktree cleanup is handled separately by the
    /// orchestrator's orphaned worktree cleanup on startup.
    pub fn delete_task(&self, id: &str) -> WorkflowResult<()> {
        // Verify task exists
        self.get_task(id)?;

        // Collect all task IDs to delete (parent + subtasks recursively)
        let mut task_ids = vec![id.to_string()];
        self.collect_subtask_ids(id, &mut task_ids)?;

        // Delete everything in one transaction
        self.store.delete_task_tree(&task_ids)
    }

    /// Recursively collect all descendant subtask IDs.
    pub(crate) fn collect_subtask_ids(
        &self,
        parent_id: &str,
        ids: &mut Vec<String>,
    ) -> WorkflowResult<()> {
        for subtask in self.store.list_subtasks(parent_id)? {
            ids.push(subtask.id.clone());
            self.collect_subtask_ids(&subtask.id, ids)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::similar_names)] // task1/task2/tasks are clear in test context
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::runtime::Status;
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

    // Note: Fallback title tests have moved to title.rs (where generate_fallback_title now lives).

    // =========================================================================
    // Delete task tests (API-level)
    // =========================================================================

    #[test]
    fn test_delete_task_cascades_to_subtasks() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task", None).unwrap();

        // Wait for setup to complete before creating subtasks
        let parent = wait_for_setup(&api, &parent.id);

        let child1 = api
            .create_subtask(&parent.id, "Child 1", "First child")
            .unwrap();
        let child2 = api
            .create_subtask(&parent.id, "Child 2", "Second child")
            .unwrap();

        // Delete parent — should cascade to subtasks
        api.delete_task(&parent.id).unwrap();

        // All tasks should be gone
        assert!(matches!(
            api.get_task(&parent.id),
            Err(WorkflowError::TaskNotFound(_))
        ));
        assert!(matches!(
            api.get_task(&child1.id),
            Err(WorkflowError::TaskNotFound(_))
        ));
        assert!(matches!(
            api.get_task(&child2.id),
            Err(WorkflowError::TaskNotFound(_))
        ));
    }

    #[test]
    fn test_delete_task_not_found() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let result = api.delete_task("nonexistent");
        assert!(matches!(result, Err(WorkflowError::TaskNotFound(_))));
    }

    #[test]
    fn test_delete_task_removes_iterations() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        // Verify iteration was created at task creation
        let iterations = api.get_iterations(&task.id).unwrap();
        assert!(!iterations.is_empty());

        // Delete and verify iterations are gone
        api.delete_task(&task.id).unwrap();
        assert!(api.store.get_iterations(&task.id).unwrap().is_empty());
    }
}
