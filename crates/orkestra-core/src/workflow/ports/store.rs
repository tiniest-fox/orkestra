//! Workflow store port for persistence operations.
//!
//! This trait abstracts over storage backends, allowing the workflow system
//! to work with SQLite, in-memory stores for testing, or other backends.

use crate::workflow::domain::{Iteration, Task};

/// Error type for workflow operations.
#[derive(Debug, thiserror::Error)]
pub enum WorkflowError {
    /// Task not found.
    #[error("Task not found: {0}")]
    TaskNotFound(String),

    /// Iteration not found.
    #[error("Iteration not found: {0}")]
    IterationNotFound(String),

    /// Invalid state transition.
    #[error("Invalid state transition: {0}")]
    InvalidTransition(String),

    /// Storage error.
    #[error("Storage error: {0}")]
    Storage(String),

    /// Lock error (for thread-safe stores).
    #[error("Lock error: failed to acquire lock")]
    Lock,
}

/// Result type for workflow operations.
pub type WorkflowResult<T> = Result<T, WorkflowError>;

/// Persistence abstraction for workflow entities.
///
/// This trait defines the contract for storing and retrieving workflow
/// domain objects. Implementations can use SQLite, in-memory storage,
/// or any other backend.
pub trait WorkflowStore: Send + Sync {
    // =========================================================================
    // Task Operations
    // =========================================================================

    /// Get a task by ID.
    fn get_task(&self, id: &str) -> WorkflowResult<Option<Task>>;

    /// Save a task (insert or update).
    fn save_task(&self, task: &Task) -> WorkflowResult<()>;

    /// List all tasks.
    fn list_tasks(&self) -> WorkflowResult<Vec<Task>>;

    /// List tasks by parent ID.
    fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>>;

    /// Delete a task by ID.
    fn delete_task(&self, id: &str) -> WorkflowResult<()>;

    /// Generate the next unique task ID.
    fn next_task_id(&self) -> WorkflowResult<String>;

    // =========================================================================
    // Iteration Operations
    // =========================================================================

    /// Get all iterations for a task.
    fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>>;

    /// Get iterations for a task filtered by stage.
    fn get_iterations_for_stage(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Vec<Iteration>>;

    /// Get the active (not ended) iteration for a task in a stage.
    fn get_active_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>>;

    /// Get the latest iteration for a task in a stage (regardless of status).
    fn get_latest_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>>;

    /// Save an iteration (insert or update by ID).
    fn save_iteration(&self, iteration: &Iteration) -> WorkflowResult<()>;

    /// Delete all iterations for a task.
    fn delete_iterations(&self, task_id: &str) -> WorkflowResult<()>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::Task;
    use crate::workflow::runtime::Phase;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// Simple in-memory store for testing the trait API.
    struct TestStore {
        tasks: Mutex<HashMap<String, Task>>,
        iterations: Mutex<Vec<Iteration>>,
        next_id: std::sync::atomic::AtomicU32,
    }

    impl TestStore {
        fn new() -> Self {
            Self {
                tasks: Mutex::new(HashMap::new()),
                iterations: Mutex::new(Vec::new()),
                next_id: std::sync::atomic::AtomicU32::new(1),
            }
        }
    }

    impl WorkflowStore for TestStore {
        fn get_task(&self, id: &str) -> WorkflowResult<Option<Task>> {
            let tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
            Ok(tasks.get(id).cloned())
        }

        fn save_task(&self, task: &Task) -> WorkflowResult<()> {
            let mut tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
            tasks.insert(task.id.clone(), task.clone());
            Ok(())
        }

        fn list_tasks(&self) -> WorkflowResult<Vec<Task>> {
            let tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
            Ok(tasks.values().cloned().collect())
        }

        fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>> {
            let tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
            Ok(tasks
                .values()
                .filter(|t| t.parent_id.as_deref() == Some(parent_id))
                .cloned()
                .collect())
        }

        fn delete_task(&self, id: &str) -> WorkflowResult<()> {
            let mut tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
            tasks.remove(id);
            Ok(())
        }

        fn next_task_id(&self) -> WorkflowResult<String> {
            let id = self
                .next_id
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(format!("task-{:03}", id))
        }

        fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
            let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
            Ok(iterations
                .iter()
                .filter(|i| i.task_id == task_id)
                .cloned()
                .collect())
        }

        fn get_iterations_for_stage(
            &self,
            task_id: &str,
            stage: &str,
        ) -> WorkflowResult<Vec<Iteration>> {
            let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
            Ok(iterations
                .iter()
                .filter(|i| i.task_id == task_id && i.stage == stage)
                .cloned()
                .collect())
        }

        fn get_active_iteration(
            &self,
            task_id: &str,
            stage: &str,
        ) -> WorkflowResult<Option<Iteration>> {
            let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
            Ok(iterations
                .iter()
                .filter(|i| i.task_id == task_id && i.stage == stage && i.is_active())
                .max_by_key(|i| i.iteration_number)
                .cloned())
        }

        fn get_latest_iteration(
            &self,
            task_id: &str,
            stage: &str,
        ) -> WorkflowResult<Option<Iteration>> {
            let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
            Ok(iterations
                .iter()
                .filter(|i| i.task_id == task_id && i.stage == stage)
                .max_by_key(|i| i.iteration_number)
                .cloned())
        }

        fn save_iteration(&self, iteration: &Iteration) -> WorkflowResult<()> {
            let mut iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
            if let Some(existing) = iterations.iter_mut().find(|i| i.id == iteration.id) {
                *existing = iteration.clone();
            } else {
                iterations.push(iteration.clone());
            }
            Ok(())
        }

        fn delete_iterations(&self, task_id: &str) -> WorkflowResult<()> {
            let mut iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
            iterations.retain(|i| i.task_id != task_id);
            Ok(())
        }
    }

    #[test]
    fn test_task_crud() {
        let store = TestStore::new();

        // Create
        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        store.save_task(&task).unwrap();

        // Read
        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.title, "Test");

        // Update
        let mut updated = loaded;
        updated.phase = Phase::AgentWorking;
        store.save_task(&updated).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.phase, Phase::AgentWorking);

        // Delete
        store.delete_task("task-1").unwrap();
        assert!(store.get_task("task-1").unwrap().is_none());
    }

    #[test]
    fn test_list_tasks() {
        let store = TestStore::new();

        store
            .save_task(&Task::new("task-1", "Task 1", "Desc", "planning", "now"))
            .unwrap();
        store
            .save_task(&Task::new("task-2", "Task 2", "Desc", "work", "now"))
            .unwrap();

        let tasks = store.list_tasks().unwrap();
        assert_eq!(tasks.len(), 2);
    }

    #[test]
    fn test_subtasks() {
        let store = TestStore::new();

        let parent = Task::new("parent", "Parent", "Desc", "planning", "now");
        store.save_task(&parent).unwrap();

        let child = Task::new("child-1", "Child 1", "Desc", "work", "now").with_parent("parent");
        store.save_task(&child).unwrap();

        let subtasks = store.list_subtasks("parent").unwrap();
        assert_eq!(subtasks.len(), 1);
        assert_eq!(subtasks[0].id, "child-1");
    }

    #[test]
    fn test_iteration_crud() {
        let store = TestStore::new();

        let task = Task::new("task-1", "Test", "Desc", "planning", "now");
        store.save_task(&task).unwrap();

        // Create iteration
        let iter = Iteration::new("iter-1", "task-1", "planning", 1, "now");
        store.save_iteration(&iter).unwrap();

        // Read
        let loaded = store.get_active_iteration("task-1", "planning").unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().iteration_number, 1);

        // Update (end iteration)
        let mut iter = store.get_active_iteration("task-1", "planning").unwrap().unwrap();
        iter.end("later", crate::workflow::runtime::Outcome::Approved);
        store.save_iteration(&iter).unwrap();

        // No longer active
        let active = store.get_active_iteration("task-1", "planning").unwrap();
        assert!(active.is_none());

        // But still latest
        let latest = store.get_latest_iteration("task-1", "planning").unwrap();
        assert!(latest.is_some());
    }

    #[test]
    fn test_next_task_id() {
        let store = TestStore::new();

        let id1 = store.next_task_id().unwrap();
        let id2 = store.next_task_id().unwrap();

        assert_ne!(id1, id2);
        assert!(id1.starts_with("task-"));
    }
}
