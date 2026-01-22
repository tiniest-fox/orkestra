//! Mock task store implementation for testing.

use crate::domain::Task;
use crate::error::Result;
use crate::ports::TaskStore;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::RwLock;

/// In-memory task store for testing.
///
/// Implements `TaskStore` trait, keeping all tasks in a `HashMap`.
/// Thread-safe via `RwLock`.
///
/// # Example
///
/// ```ignore
/// use orkestra_core::testutil::MockStore;
/// use orkestra_core::ports::TaskStore;
///
/// let store = MockStore::new();
/// assert_eq!(store.next_id().unwrap(), "TASK-001");
/// ```
pub struct MockStore {
    tasks: RwLock<HashMap<String, Task>>,
    next_id: AtomicU32,
}

impl MockStore {
    /// Create a new empty mock store.
    pub fn new() -> Self {
        Self {
            tasks: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }

    /// Get a snapshot of all tasks (for test assertions).
    pub fn snapshot(&self) -> HashMap<String, Task> {
        self.tasks.read().unwrap().clone()
    }

    /// Get the number of tasks in the store.
    pub fn len(&self) -> usize {
        self.tasks.read().unwrap().len()
    }

    /// Check if the store is empty.
    pub fn is_empty(&self) -> bool {
        self.tasks.read().unwrap().is_empty()
    }

    /// Clear all tasks from the store.
    pub fn clear(&self) {
        self.tasks.write().unwrap().clear();
    }
}

impl Default for MockStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskStore for MockStore {
    fn load_all(&self) -> Result<Vec<Task>> {
        let mut tasks: Vec<Task> = self.tasks.read().unwrap().values().cloned().collect();
        tasks.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(tasks)
    }

    fn find_by_id(&self, id: &str) -> Result<Option<Task>> {
        Ok(self.tasks.read().unwrap().get(id).cloned())
    }

    fn save(&self, task: &Task) -> Result<()> {
        self.tasks
            .write()
            .unwrap()
            .insert(task.id.clone(), task.clone());
        Ok(())
    }

    fn save_all(&self, tasks: &[Task]) -> Result<()> {
        let mut store = self.tasks.write().unwrap();
        store.clear();
        for task in tasks {
            store.insert(task.id.clone(), task.clone());
        }
        Ok(())
    }

    fn next_id(&self) -> Result<String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        Ok(format!("TASK-{id:03}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_store_id_generation() {
        let store = MockStore::new();
        assert_eq!(store.next_id().unwrap(), "TASK-001");
        assert_eq!(store.next_id().unwrap(), "TASK-002");
        assert_eq!(store.next_id().unwrap(), "TASK-003");
    }

    #[test]
    fn test_mock_store_initially_empty() {
        let store = MockStore::new();
        assert!(store.is_empty());
        assert_eq!(store.len(), 0);
        assert!(store.load_all().unwrap().is_empty());
    }
}
