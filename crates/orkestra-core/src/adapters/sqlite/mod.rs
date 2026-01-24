//! SQLite-based storage implementation.
//!
//! This module provides a modular SQLite adapter with:
//! - `DatabaseConnection` - Shared connection wrapper
//! - `SqliteStore` - Facade implementing `TaskStore` trait
//! - Repositories for each entity type
//! - Refinery-based migrations

mod connection;
pub mod migrations;
pub mod repositories;

pub use connection::DatabaseConnection;
pub use repositories::{IterationRepository, StageSessionRepository, TaskRepository, WorkLoopRepository};

use std::path::Path;

use crate::domain::{Task, TaskKind, TaskStatus};
use crate::error::Result;
use crate::ports::TaskStore;
use crate::state::TaskPhase;

/// SQLite-based task storage.
///
/// Composes repositories for different entities and implements
/// the `TaskStore` trait by delegating to the appropriate repository.
pub struct SqliteStore {
    db: DatabaseConnection,
    pub tasks: TaskRepository,
    pub iterations: IterationRepository,
    pub stage_sessions: StageSessionRepository,
    pub work_loops: WorkLoopRepository,
}

impl SqliteStore {
    /// Create a new SQLite store for a specific project directory.
    ///
    /// The database will be created at `{project_root}/.orkestra/tasks.db`.
    pub fn for_project(project_root: &Path) -> Result<Self> {
        let path = project_root.join(".orkestra").join("tasks.db");
        let db = DatabaseConnection::open(&path)?;
        Self::from_connection(db)
    }

    /// Create an in-memory store for testing.
    pub fn in_memory() -> Result<Self> {
        let db = DatabaseConnection::in_memory()?;
        Self::from_connection(db)
    }

    /// Create store from an existing database connection.
    fn from_connection(db: DatabaseConnection) -> Result<Self> {
        let conn = db.shared();
        Ok(Self {
            tasks: TaskRepository::new(conn.clone()),
            iterations: IterationRepository::new(conn.clone()),
            stage_sessions: StageSessionRepository::new(conn.clone()),
            work_loops: WorkLoopRepository::new(conn),
            db,
        })
    }

    /// Force a WAL checkpoint to sync the database.
    pub fn checkpoint(&self) -> Result<()> {
        self.db.checkpoint()
    }

    /// Generate the next unique task ID.
    pub fn next_id(&self) -> Result<String> {
        self.tasks.next_id()
    }

    /// Update a single field on a task atomically.
    pub fn update_field(&self, task_id: &str, field: &str, value: Option<&str>) -> Result<()> {
        self.tasks.update_field(task_id, field, value)
    }

    /// Update task status atomically.
    pub fn update_status(&self, task_id: &str, status: TaskStatus) -> Result<()> {
        self.tasks.update_status(task_id, status)
    }

    /// Update task phase atomically.
    pub fn update_phase(&self, task_id: &str, phase: TaskPhase) -> Result<()> {
        self.tasks.update_phase(task_id, phase)
    }

    /// Update agent PID atomically.
    pub fn update_agent_pid(&self, task_id: &str, pid: Option<u32>) -> Result<()> {
        self.tasks.update_agent_pid(task_id, pid)
    }

    /// Get child tasks (kind = 'task').
    pub fn get_child_tasks(&self, parent_id: &str) -> Result<Vec<Task>> {
        self.tasks.find_children(parent_id, Some(TaskKind::Task))
    }

    /// Get subtasks (kind = 'subtask').
    pub fn get_subtasks(&self, parent_id: &str) -> Result<Vec<Task>> {
        self.tasks.find_children(parent_id, Some(TaskKind::Subtask))
    }
}

impl TaskStore for SqliteStore {
    fn load_all(&self) -> Result<Vec<Task>> {
        self.tasks.find_all()
    }

    fn find_by_id(&self, id: &str) -> Result<Option<Task>> {
        self.tasks.find_by_id(id)
    }

    fn save(&self, task: &Task) -> Result<()> {
        self.tasks.save(task)
    }

    fn save_all(&self, tasks: &[Task]) -> Result<()> {
        self.tasks.save_all(tasks)
    }

    fn delete(&self, id: &str) -> Result<()> {
        // Delete all related data first
        self.iterations.delete_for_task(id)?;
        self.stage_sessions.delete_for_task(id)?;
        self.work_loops.delete_for_task(id)?;
        self.tasks.delete(id)
    }

    fn next_id(&self) -> Result<String> {
        self.tasks.next_id()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_load_task() {
        let store = SqliteStore::in_memory().unwrap();

        let task = Task::new(
            "TASK-001".into(),
            Some("Test".into()),
            "Description".into(),
            "2024-01-01T00:00:00Z",
        );
        store.save(&task).unwrap();

        let loaded = store.find_by_id("TASK-001").unwrap().unwrap();
        assert_eq!(loaded.title, Some("Test".to_string()));
        assert_eq!(loaded.status, TaskStatus::Planning);
    }

    #[test]
    fn test_next_id() {
        let store = SqliteStore::in_memory().unwrap();

        // Petnames should be hyphenated words
        let id1 = store.next_id().unwrap();
        assert!(id1.contains('-'), "Petname should contain hyphens: {id1}");

        // Save task with that ID
        let task = Task::new(id1.clone(), Some("Test".into()), "Desc".into(), "now");
        store.save(&task).unwrap();

        // Next ID should be different
        let id2 = store.next_id().unwrap();
        assert_ne!(id1, id2, "IDs should be unique");
    }
}
