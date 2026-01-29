//! In-memory workflow store for testing.
//!
//! This is a simple implementation that stores everything in memory.
//! Useful for unit tests and development.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use crate::workflow::domain::{Iteration, StageSession, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

/// In-memory implementation of `WorkflowStore` for testing.
pub struct InMemoryWorkflowStore {
    tasks: Mutex<HashMap<String, Task>>,
    iterations: Mutex<Vec<Iteration>>,
    stage_sessions: Mutex<Vec<StageSession>>,
    next_id: AtomicU32,
}

impl InMemoryWorkflowStore {
    /// Create a new empty in-memory store.
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            iterations: Mutex::new(Vec::new()),
            stage_sessions: Mutex::new(Vec::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

impl Default for InMemoryWorkflowStore {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkflowStore for InMemoryWorkflowStore {
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
        let mut result: Vec<_> = tasks.values().cloned().collect();
        result.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(result)
    }

    fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>> {
        let tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = tasks
            .values()
            .filter(|t| t.parent_id.as_deref() == Some(parent_id))
            .cloned()
            .collect();
        result.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(result)
    }

    fn delete_task(&self, id: &str) -> WorkflowResult<()> {
        let mut tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
        tasks.remove(id);
        Ok(())
    }

    fn next_task_id(&self) -> WorkflowResult<String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        Ok(format!("task-{id:03}"))
    }

    fn list_all_iterations(&self) -> WorkflowResult<Vec<Iteration>> {
        let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = iterations.clone();
        result.sort_by(|a, b| {
            a.task_id
                .cmp(&b.task_id)
                .then(a.stage.cmp(&b.stage))
                .then(a.iteration_number.cmp(&b.iteration_number))
        });
        Ok(result)
    }

    fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
        let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = iterations
            .iter()
            .filter(|i| i.task_id == task_id)
            .cloned()
            .collect();
        result.sort_by_key(|i| (i.stage.clone(), i.iteration_number));
        Ok(result)
    }

    fn get_iterations_for_stage(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Vec<Iteration>> {
        let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = iterations
            .iter()
            .filter(|i| i.task_id == task_id && i.stage == stage)
            .cloned()
            .collect();
        result.sort_by_key(|i| i.iteration_number);
        Ok(result)
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

    fn get_stage_session(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<StageSession>> {
        let sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        Ok(sessions
            .iter()
            .find(|s| s.task_id == task_id && s.stage == stage)
            .cloned())
    }

    fn list_all_stage_sessions(&self) -> WorkflowResult<Vec<StageSession>> {
        let sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = sessions.clone();
        result.sort_by(|a, b| a.task_id.cmp(&b.task_id).then(a.created_at.cmp(&b.created_at)));
        Ok(result)
    }

    fn get_stage_sessions(&self, task_id: &str) -> WorkflowResult<Vec<StageSession>> {
        let sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        Ok(sessions
            .iter()
            .filter(|s| s.task_id == task_id)
            .cloned()
            .collect())
    }

    fn get_sessions_with_pids(&self) -> WorkflowResult<Vec<StageSession>> {
        let sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        Ok(sessions
            .iter()
            .filter(|s| s.agent_pid.is_some())
            .cloned()
            .collect())
    }

    fn save_stage_session(&self, session: &StageSession) -> WorkflowResult<()> {
        let mut sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        if let Some(existing) = sessions.iter_mut().find(|s| s.id == session.id) {
            *existing = session.clone();
        } else {
            sessions.push(session.clone());
        }
        Ok(())
    }

    fn delete_stage_sessions(&self, task_id: &str) -> WorkflowResult<()> {
        let mut sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        sessions.retain(|s| s.task_id != task_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::runtime::{Outcome, Phase};

    #[test]
    fn test_task_crud() {
        let store = InMemoryWorkflowStore::new();

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        store.save_task(&task).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.title, "Test");

        let mut updated = loaded;
        updated.phase = Phase::AgentWorking;
        store.save_task(&updated).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.phase, Phase::AgentWorking);

        store.delete_task("task-1").unwrap();
        assert!(store.get_task("task-1").unwrap().is_none());
    }

    #[test]
    fn test_iteration_lifecycle() {
        let store = InMemoryWorkflowStore::new();

        let task = Task::new("task-1", "Test", "Desc", "planning", "now");
        store.save_task(&task).unwrap();

        let iter = Iteration::new("iter-1", "task-1", "planning", 1, "now");
        store.save_iteration(&iter).unwrap();

        let active = store.get_active_iteration("task-1", "planning").unwrap();
        assert!(active.is_some());

        let mut iter = active.unwrap();
        iter.end("later", Outcome::Approved);
        store.save_iteration(&iter).unwrap();

        let active = store.get_active_iteration("task-1", "planning").unwrap();
        assert!(active.is_none());

        let latest = store.get_latest_iteration("task-1", "planning").unwrap();
        assert!(latest.is_some());
    }

    #[test]
    fn test_unique_task_ids() {
        let store = InMemoryWorkflowStore::new();

        let id1 = store.next_task_id().unwrap();
        let id2 = store.next_task_id().unwrap();
        let id3 = store.next_task_id().unwrap();

        assert_eq!(id1, "task-001");
        assert_eq!(id2, "task-002");
        assert_eq!(id3, "task-003");
    }
}
