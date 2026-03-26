//! Task CRUD operations.

use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::{Task, TaskCreationMode};
use crate::workflow::ports::{WorkflowError, WorkflowResult};

use super::interactions as task_interactions;

impl WorkflowApi {
    /// Create a new task. Starts in the first workflow stage.
    pub fn create_task(
        &self,
        title: &str,
        description: &str,
        base_branch: Option<&str>,
    ) -> WorkflowResult<Task> {
        self.create_task_with_options(
            title,
            description,
            base_branch,
            TaskCreationMode::Normal,
            None,
        )
    }

    /// Create a new task with options (`mode`, flow).
    pub fn create_task_with_options(
        &self,
        title: &str,
        description: &str,
        base_branch: Option<&str>,
        mode: TaskCreationMode,
        flow: Option<&str>,
    ) -> WorkflowResult<Task> {
        task_interactions::create::execute(
            self.store.as_ref(),
            &self.workflow,
            self.git_service.as_deref(),
            &self.iteration_service,
            title,
            description,
            base_branch,
            mode,
            flow,
        )
    }

    /// Create a new task in interactive mode.
    ///
    /// The task is created with `created_interactive: true` flag. After worktree setup completes,
    /// the task transitions to `Interactive` state instead of `Queued`.
    pub fn create_interactive_task(
        &self,
        title: &str,
        description: &str,
        base_branch: Option<&str>,
        flow: Option<&str>,
    ) -> WorkflowResult<Task> {
        task_interactions::create::execute(
            self.store.as_ref(),
            &self.workflow,
            self.git_service.as_deref(),
            &self.iteration_service,
            title,
            description,
            base_branch,
            TaskCreationMode::Interactive,
            flow,
        )
    }

    /// Create a new subtask under a parent task.
    pub fn create_subtask(
        &self,
        parent_id: &str,
        title: &str,
        description: &str,
    ) -> WorkflowResult<Task> {
        task_interactions::create_subtask::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            parent_id,
            title,
            description,
        )
    }

    /// Get a task by ID.
    pub fn get_task(&self, id: &str) -> WorkflowResult<Task> {
        self.store
            .get_task(id)?
            .ok_or_else(|| WorkflowError::TaskNotFound(id.into()))
    }

    /// List all active top-level tasks (excluding archived, without parents).
    pub fn list_tasks(&self) -> WorkflowResult<Vec<Task>> {
        task_interactions::list::list_active(self.store.as_ref())
    }

    /// List all archived top-level tasks (tasks without parents).
    pub fn list_archived_tasks(&self) -> WorkflowResult<Vec<Task>> {
        task_interactions::list::list_archived(self.store.as_ref())
    }

    /// List subtasks of a parent task.
    pub fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>> {
        task_interactions::list::list_subtasks(self.store.as_ref(), parent_id)
    }

    /// Delete a task, its subtasks, and all associated data.
    pub fn delete_task(&self, id: &str) -> WorkflowResult<()> {
        task_interactions::delete::execute(self.store.as_ref(), id)
    }

    /// Recursively collect all descendant subtask IDs.
    pub(crate) fn collect_subtask_ids(
        &self,
        parent_id: &str,
        ids: &mut Vec<String>,
    ) -> WorkflowResult<()> {
        task_interactions::delete::collect_subtask_ids(self.store.as_ref(), parent_id, ids)
    }
}

#[cfg(test)]
#[allow(clippy::similar_names)] // task1/task2/tasks are clear in test context
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::runtime::TaskState;
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

    use super::*;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary"),
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

    /// Complete setup for a task (unit tests don't have an orchestrator).
    ///
    /// Unit tests use `InMemoryWorkflowStore` without an orchestrator, so tasks
    /// stay in `AwaitingSetup`. This helper manually transitions to `Idle`.
    fn complete_setup(api: &WorkflowApi, task_id: &str) -> Task {
        let mut task = api.get_task(task_id).unwrap();
        task.state = TaskState::queued("planning");
        api.store.save_task(&task).unwrap();
        task
    }

    #[test]
    fn test_create_subtask() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task", None).unwrap();

        // Wait for parent setup to complete
        let parent = complete_setup(&api, &parent.id);

        let subtask = api
            .create_subtask(&parent.id, "Child", "Child task")
            .unwrap();

        assert_eq!(subtask.parent_id, Some(parent.id.clone()));
    }

    #[test]
    fn test_create_subtask_rejects_awaiting_setup_parent() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task", None).unwrap();

        // Immediately try to create subtask - parent should still be in AwaitingSetup
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
        let parent = complete_setup(&api, &parent.id);

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
        let parent = complete_setup(&api, &parent.id);

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
        task2.state = TaskState::Archived;
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
        task2.state = TaskState::Archived;
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
        let parent = complete_setup(&api, &parent.id);

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
