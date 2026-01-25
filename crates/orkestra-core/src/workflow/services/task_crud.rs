//! Task CRUD operations.

use crate::workflow::domain::{Iteration, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult};

use super::WorkflowApi;

impl WorkflowApi {
    /// Create a new task. Starts in the first workflow stage.
    pub fn create_task(&self, title: &str, description: &str) -> WorkflowResult<Task> {
        let id = self.store.next_task_id()?;
        let first_stage = self
            .workflow
            .first_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("No stages in workflow".into()))?;

        let now = chrono::Utc::now().to_rfc3339();
        let task = Task::new(&id, title, description, &first_stage.name, &now);

        self.store.save_task(&task)?;

        // Create initial iteration
        let iteration = Iteration::new(
            format!("{}-iter-1", id),
            &id,
            &first_stage.name,
            1,
            &now,
        );
        self.store.save_iteration(&iteration)?;

        Ok(task)
    }

    /// Create a new task with a parent (subtask).
    pub fn create_subtask(
        &self,
        parent_id: &str,
        title: &str,
        description: &str,
    ) -> WorkflowResult<Task> {
        // Verify parent exists
        let _ = self.get_task(parent_id)?;

        let id = self.store.next_task_id()?;
        let first_stage = self
            .workflow
            .first_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("No stages in workflow".into()))?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut task = Task::new(&id, title, description, &first_stage.name, &now);
        task.parent_id = Some(parent_id.to_string());

        self.store.save_task(&task)?;

        // Create initial iteration
        let iteration = Iteration::new(
            format!("{}-iter-1", id),
            &id,
            &first_stage.name,
            1,
            &now,
        );
        self.store.save_iteration(&iteration)?;

        Ok(task)
    }

    /// Get a task by ID.
    pub fn get_task(&self, id: &str) -> WorkflowResult<Task> {
        self.store
            .get_task(id)?
            .ok_or_else(|| WorkflowError::TaskNotFound(id.into()))
    }

    /// List all top-level tasks (tasks without parents).
    pub fn list_tasks(&self) -> WorkflowResult<Vec<Task>> {
        let all_tasks = self.store.list_tasks()?;
        Ok(all_tasks.into_iter().filter(|t| t.parent_id.is_none()).collect())
    }

    /// List subtasks of a parent task.
    pub fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>> {
        self.store.list_subtasks(parent_id)
    }

    /// Delete a task and its iterations.
    ///
    /// Note: This does not delete child tasks. Call recursively if needed.
    pub fn delete_task(&self, id: &str) -> WorkflowResult<()> {
        // Verify task exists
        let _ = self.get_task(id)?;

        // Delete iterations first
        self.store.delete_iterations(id)?;

        // Delete task
        self.store.delete_task(id)
    }
}

#[cfg(test)]
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::InMemoryWorkflowStore;

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
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Fix bug", "Fix the login bug").unwrap();

        assert_eq!(task.title, "Fix bug");
        assert_eq!(task.description, "Fix the login bug");
        assert_eq!(task.current_stage(), Some("planning"));
        assert!(task.parent_id.is_none());
    }

    #[test]
    fn test_create_subtask() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task").unwrap();
        let subtask = api.create_subtask(&parent.id, "Child", "Child task").unwrap();

        assert_eq!(subtask.parent_id, Some(parent.id.clone()));
    }

    #[test]
    fn test_get_task() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();
        let fetched = api.get_task(&task.id).unwrap();

        assert_eq!(fetched.id, task.id);
        assert_eq!(fetched.title, "Test");
    }

    #[test]
    fn test_get_task_not_found() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let result = api.get_task("nonexistent");
        assert!(matches!(result, Err(WorkflowError::TaskNotFound(_))));
    }

    #[test]
    fn test_list_tasks_excludes_subtasks() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task").unwrap();
        let _ = api.create_subtask(&parent.id, "Child", "Child task").unwrap();
        let task2 = api.create_task("Task 2", "Second task").unwrap();

        let tasks = api.list_tasks().unwrap();
        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().any(|t| t.id == parent.id));
        assert!(tasks.iter().any(|t| t.id == task2.id));
    }

    #[test]
    fn test_list_subtasks() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task").unwrap();
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
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();
        api.delete_task(&task.id).unwrap();

        let result = api.get_task(&task.id);
        assert!(matches!(result, Err(WorkflowError::TaskNotFound(_))));
    }

    #[test]
    fn test_create_task_creates_iteration() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();
        let iterations = api.get_iterations(&task.id).unwrap();

        assert_eq!(iterations.len(), 1);
        assert_eq!(iterations[0].stage, "planning");
        assert_eq!(iterations[0].iteration_number, 1);
    }
}
