use crate::domain::Task;
use crate::error::Result;

/// Abstraction over task persistence.
///
/// This trait allows the task service to work with different storage backends
/// (JSONL files, databases, etc.) and enables easy testing with mock stores.
pub trait TaskStore: Send + Sync {
    /// Load all tasks from storage.
    fn load_all(&self) -> Result<Vec<Task>>;

    /// Find a task by its ID.
    fn find_by_id(&self, id: &str) -> Result<Option<Task>>;

    /// Save a single task (append to storage).
    fn save(&self, task: &Task) -> Result<()>;

    /// Save all tasks (overwrite storage).
    fn save_all(&self, tasks: &[Task]) -> Result<()>;

    /// Delete a task by its ID.
    fn delete(&self, id: &str) -> Result<()>;

    /// Generate the next available task ID.
    fn next_id(&self) -> Result<String>;
}
