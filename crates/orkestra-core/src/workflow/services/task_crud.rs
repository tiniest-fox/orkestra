//! Task CRUD operations.

use std::sync::Arc;
use std::thread;

use crate::title::generate_title_sync;
use crate::workflow::domain::{Iteration, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

use super::{workflow_warn, WorkflowApi};

impl WorkflowApi {
    /// Create a new task. Starts in the first workflow stage.
    ///
    /// If `title` is empty, a background thread will generate one using AI.
    /// The task is returned immediately with empty title, which will be filled in asynchronously.
    ///
    /// If git service is configured, creates a worktree and branch for the task.
    /// The `base_branch` parameter specifies which branch to create from (defaults to current branch).
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

        // Create git worktree if git service is configured
        if let Some(git) = &self.git_service {
            match git.create_worktree(&id, base_branch) {
                Ok(result) => {
                    task.branch_name = Some(result.branch_name);
                    task.worktree_path = Some(result.worktree_path.to_string_lossy().to_string());
                }
                Err(e) => {
                    // Log but don't fail task creation
                    workflow_warn!("Failed to create worktree for {}: {}", id, e);
                }
            }
        }

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

        // If title is empty, generate one in the background
        if title.trim().is_empty() && !description.trim().is_empty() {
            spawn_title_generation(self.store.clone(), id.clone(), description.to_string());
        }

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
    /// If git service is configured and the task has a worktree, it will be cleaned up
    /// along with its branch.
    ///
    /// Note: This does not delete child tasks. Call recursively if needed.
    pub fn delete_task(&self, id: &str) -> WorkflowResult<()> {
        // Verify task exists and get worktree info
        let task = self.get_task(id)?;

        // Clean up git worktree and branch if present
        if let Some(git) = &self.git_service {
            if task.worktree_path.is_some() {
                if let Err(e) = git.remove_worktree(id, true) {
                    workflow_warn!("Failed to remove worktree for {}: {}", id, e);
                }
            }
        }

        // Delete iterations first
        self.store.delete_iterations(id)?;

        // Delete task
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;
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
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Fix bug", "Fix the login bug", None).unwrap();

        assert_eq!(task.title, "Fix bug");
        assert_eq!(task.description, "Fix the login bug");
        assert_eq!(task.current_stage(), Some("planning"));
        assert!(task.parent_id.is_none());
    }

    #[test]
    fn test_create_subtask() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let parent = api.create_task("Parent", "Parent task", None).unwrap();
        let subtask = api.create_subtask(&parent.id, "Child", "Child task").unwrap();

        assert_eq!(subtask.parent_id, Some(parent.id.clone()));
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
        let _ = api.create_subtask(&parent.id, "Child", "Child task").unwrap();
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
}
