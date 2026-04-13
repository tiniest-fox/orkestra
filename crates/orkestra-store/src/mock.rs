//! In-memory workflow store for testing.
//!
//! This is a simple implementation that stores everything in memory.
//! Useful for unit tests and development.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use orkestra_types::domain::{
    AnnotatedLogEntry, AssistantSession, GateResult, Iteration, LogEntry, SessionState,
    SessionType, StageSession, Task,
};

use crate::interface::{WorkflowError, WorkflowResult, WorkflowStore};

type LogEntryRecord = (String, i64, LogEntry, Option<String>);

/// In-memory implementation of `WorkflowStore` for testing.
pub struct InMemoryWorkflowStore {
    tasks: Mutex<HashMap<String, Task>>,
    iterations: Mutex<Vec<Iteration>>,
    stage_sessions: Mutex<Vec<StageSession>>,
    assistant_sessions: Mutex<Vec<AssistantSession>>,
    log_entries: Mutex<Vec<LogEntryRecord>>,
    next_id: AtomicU32,
}

impl InMemoryWorkflowStore {
    /// Create a new empty in-memory store.
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            iterations: Mutex::new(Vec::new()),
            stage_sessions: Mutex::new(Vec::new()),
            assistant_sessions: Mutex::new(Vec::new()),
            log_entries: Mutex::new(Vec::new()),
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
        Ok(format!("adverb-adjective-noun{id:03}"))
    }

    fn next_subtask_id(&self, parent_id: &str) -> WorkflowResult<String> {
        let tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
        let sibling_last_words: Vec<String> = tasks
            .values()
            .filter(|t| t.parent_id.as_deref() == Some(parent_id))
            .filter_map(|t| t.id.rsplit('-').next().map(String::from))
            .collect();
        drop(tasks);

        // Generate IDs until we find one with a unique last word among siblings
        for _ in 0..100 {
            let id_num = self.next_id.fetch_add(1, Ordering::SeqCst);
            let id = format!("adverb-adjective-noun{id_num:03}");
            let last_word = id.rsplit('-').next().unwrap_or(&id);
            if !sibling_last_words.iter().any(|w| w == last_word) {
                return Ok(id);
            }
        }

        Err(WorkflowError::Storage(
            "Failed to generate unique subtask ID after 100 attempts".into(),
        ))
    }

    fn touch_task(&self, id: &str) -> WorkflowResult<()> {
        let mut tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
        match tasks.get_mut(id) {
            Some(task) => {
                task.updated_at = chrono::Utc::now().to_rfc3339();
                Ok(())
            }
            None => Err(WorkflowError::TaskNotFound(id.to_string())),
        }
    }

    fn list_all_iterations(&self) -> WorkflowResult<Vec<Iteration>> {
        let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = iterations.clone();
        result.sort_by(|a, b| {
            a.task_id
                .cmp(&b.task_id)
                .then(a.started_at.cmp(&b.started_at))
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
        result.sort_by(|a, b| {
            a.started_at
                .cmp(&b.started_at)
                .then(a.iteration_number.cmp(&b.iteration_number))
        });
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

    fn save_gate_result(&self, iteration_id: &str, gate_result: &GateResult) -> WorkflowResult<()> {
        let mut iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
        if let Some(existing) = iterations.iter_mut().find(|i| i.id == iteration_id) {
            existing.gate_result = Some(gate_result.clone());
            Ok(())
        } else {
            Err(WorkflowError::IterationNotFound(iteration_id.to_string()))
        }
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
            .filter(|s| {
                s.task_id == task_id
                    && s.stage == stage
                    && s.session_state != SessionState::Superseded
            })
            .max_by(|a, b| a.created_at.cmp(&b.created_at))
            .cloned())
    }

    fn list_all_stage_sessions(&self) -> WorkflowResult<Vec<StageSession>> {
        let sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = sessions.clone();
        result.sort_by(|a, b| {
            a.task_id
                .cmp(&b.task_id)
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(result)
    }

    fn list_iterations_for_tasks(&self, task_ids: &[&str]) -> WorkflowResult<Vec<Iteration>> {
        let iterations = self.iterations.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = iterations
            .iter()
            .filter(|i| task_ids.contains(&i.task_id.as_str()))
            .cloned()
            .collect();
        result.sort_by(|a, b| {
            a.task_id
                .cmp(&b.task_id)
                .then(a.started_at.cmp(&b.started_at))
                .then(a.iteration_number.cmp(&b.iteration_number))
        });
        Ok(result)
    }

    fn list_stage_sessions_for_tasks(
        &self,
        task_ids: &[&str],
    ) -> WorkflowResult<Vec<StageSession>> {
        let sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = sessions
            .iter()
            .filter(|s| task_ids.contains(&s.task_id.as_str()))
            .cloned()
            .collect();
        result.sort_by(|a, b| {
            a.task_id
                .cmp(&b.task_id)
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(result)
    }

    fn list_archived_subtasks_by_parents(&self, parent_ids: &[&str]) -> WorkflowResult<Vec<Task>> {
        let tasks = self.tasks.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = tasks
            .values()
            .filter(|t| {
                t.parent_id
                    .as_deref()
                    .is_some_and(|pid| parent_ids.contains(&pid))
                    && t.is_archived()
            })
            .cloned()
            .collect();
        result.sort_by(|a, b| a.created_at.cmp(&b.created_at));
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

    fn clear_agent_pid_for_session(
        &self,
        session_id: &str,
        expected_pid: u32,
    ) -> WorkflowResult<bool> {
        let mut sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        if let Some(session) = sessions
            .iter_mut()
            .find(|s| s.id == session_id && s.agent_pid == Some(expected_pid))
        {
            session.agent_pid = None;
            session.chat_active = false;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn delete_stage_sessions(&self, task_id: &str) -> WorkflowResult<()> {
        let mut sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        sessions.retain(|s| s.task_id != task_id);
        Ok(())
    }

    fn append_log_entry(
        &self,
        stage_session_id: &str,
        entry: &LogEntry,
        iteration_id: Option<&str>,
    ) -> WorkflowResult<()> {
        let mut entries = self.log_entries.lock().map_err(|_| WorkflowError::Lock)?;
        let next_seq = entries
            .iter()
            .filter(|(sid, _, _, _)| sid == stage_session_id)
            .map(|(_, seq, _, _)| *seq)
            .max()
            .unwrap_or(0)
            + 1;
        entries.push((
            stage_session_id.to_string(),
            next_seq,
            entry.clone(),
            iteration_id.map(String::from),
        ));
        Ok(())
    }

    fn get_log_entries(&self, stage_session_id: &str) -> WorkflowResult<Vec<LogEntry>> {
        let entries = self.log_entries.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = entries
            .iter()
            .filter(|(sid, _, _, _)| sid == stage_session_id)
            .cloned()
            .collect();
        result.sort_by_key(|(_, seq, _, _)| *seq);
        Ok(result.into_iter().map(|(_, _, entry, _)| entry).collect())
    }

    fn get_log_entries_after(
        &self,
        stage_session_id: &str,
        after_sequence: u64,
    ) -> WorkflowResult<(Vec<LogEntry>, Option<u64>)> {
        let entries = self.log_entries.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = entries
            .iter()
            .filter(|(sid, seq, _, _)| {
                sid == stage_session_id
                    && u64::try_from(*seq).expect("sequence numbers must be non-negative")
                        > after_sequence
            })
            .cloned()
            .collect();
        result.sort_by_key(|(_, seq, _, _)| *seq);
        let max_seq = result
            .iter()
            .map(|(_, seq, _, _)| {
                u64::try_from(*seq).expect("sequence numbers must be non-negative")
            })
            .max();
        Ok((
            result.into_iter().map(|(_, _, entry, _)| entry).collect(),
            max_seq,
        ))
    }

    fn get_annotated_log_entries(
        &self,
        stage_session_id: &str,
    ) -> WorkflowResult<Vec<AnnotatedLogEntry>> {
        let entries = self.log_entries.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = entries
            .iter()
            .filter(|(sid, _, _, _)| sid == stage_session_id)
            .cloned()
            .collect();
        result.sort_by_key(|(_, seq, _, _)| *seq);
        Ok(result
            .into_iter()
            .map(|(_, _, entry, iteration_id)| AnnotatedLogEntry {
                entry,
                iteration_id,
            })
            .collect())
    }

    fn get_latest_log_entry(&self, stage_session_id: &str) -> WorkflowResult<Option<LogEntry>> {
        let entries = self.log_entries.lock().map_err(|_| WorkflowError::Lock)?;
        Ok(entries
            .iter()
            .filter(|(sid, _, _, _)| sid == stage_session_id)
            .max_by_key(|(_, seq, _, _)| *seq)
            .map(|(_, _, entry, _)| entry.clone()))
    }

    fn delete_log_entries_for_task(&self, task_id: &str) -> WorkflowResult<()> {
        let sessions = self
            .stage_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        let session_ids: Vec<String> = sessions
            .iter()
            .filter(|s| s.task_id == task_id)
            .map(|s| s.id.clone())
            .collect();
        drop(sessions);

        let mut entries = self.log_entries.lock().map_err(|_| WorkflowError::Lock)?;
        entries.retain(|(sid, _, _, _)| !session_ids.contains(sid));
        Ok(())
    }

    fn get_assistant_session(&self, id: &str) -> WorkflowResult<Option<AssistantSession>> {
        let sessions = self
            .assistant_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        Ok(sessions.iter().find(|s| s.id == id).cloned())
    }

    fn save_assistant_session(&self, session: &AssistantSession) -> WorkflowResult<()> {
        let mut sessions = self
            .assistant_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        if let Some(existing) = sessions.iter_mut().find(|s| s.id == session.id) {
            *existing = session.clone();
        } else {
            sessions.push(session.clone());
        }
        Ok(())
    }

    fn list_assistant_sessions(&self) -> WorkflowResult<Vec<AssistantSession>> {
        let sessions = self
            .assistant_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = sessions.clone();
        result.sort_by(|a, b| b.created_at.cmp(&a.created_at)); // DESC order
        Ok(result)
    }

    fn delete_assistant_session(&self, id: &str) -> WorkflowResult<()> {
        let mut sessions = self
            .assistant_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        sessions.retain(|s| s.id != id);
        Ok(())
    }

    fn get_assistant_session_for_task(
        &self,
        task_id: &str,
        session_type: &SessionType,
    ) -> WorkflowResult<Option<AssistantSession>> {
        let sessions = self
            .assistant_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        Ok(sessions
            .iter()
            .find(|s| s.task_id.as_deref() == Some(task_id) && &s.session_type == session_type)
            .cloned())
    }

    fn get_or_create_assistant_session_for_task(
        &self,
        task_id: &str,
        session_type: &SessionType,
        new_session: &AssistantSession,
    ) -> WorkflowResult<AssistantSession> {
        // Hold the lock for the entire check-and-insert to make this atomic.
        let mut sessions = self
            .assistant_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        if let Some(existing) = sessions
            .iter()
            .find(|s| s.task_id.as_deref() == Some(task_id) && &s.session_type == session_type)
        {
            return Ok(existing.clone());
        }
        sessions.push(new_session.clone());
        Ok(new_session.clone())
    }

    fn list_project_assistant_sessions(&self) -> WorkflowResult<Vec<AssistantSession>> {
        let sessions = self
            .assistant_sessions
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = sessions
            .iter()
            .filter(|s| s.task_id.is_none())
            .cloned()
            .collect();
        result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(result)
    }

    fn append_assistant_log_entry(
        &self,
        assistant_session_id: &str,
        entry: &LogEntry,
    ) -> WorkflowResult<()> {
        let mut entries = self.log_entries.lock().map_err(|_| WorkflowError::Lock)?;
        let next_seq = entries
            .iter()
            .filter(|(sid, _, _, _)| sid == assistant_session_id)
            .map(|(_, seq, _, _)| *seq)
            .max()
            .unwrap_or(0)
            + 1;
        entries.push((
            assistant_session_id.to_string(),
            next_seq,
            entry.clone(),
            None,
        ));
        Ok(())
    }

    fn get_assistant_log_entries(
        &self,
        assistant_session_id: &str,
    ) -> WorkflowResult<Vec<LogEntry>> {
        let entries = self.log_entries.lock().map_err(|_| WorkflowError::Lock)?;
        let mut result: Vec<_> = entries
            .iter()
            .filter(|(sid, _, _, _)| sid == assistant_session_id)
            .cloned()
            .collect();
        result.sort_by_key(|(_, seq, _, _)| *seq);
        Ok(result.into_iter().map(|(_, _, entry, _)| entry).collect())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use orkestra_types::runtime::{Outcome, TaskState};

    #[test]
    fn test_task_crud() {
        let store = InMemoryWorkflowStore::new();

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        store.save_task(&task).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.title, "Test");

        let mut updated = loaded;
        updated.state = TaskState::agent_working("planning");
        store.save_task(&updated).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.state, TaskState::agent_working("planning"));

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

        assert_eq!(id1, "adverb-adjective-noun001");
        assert_eq!(id2, "adverb-adjective-noun002");
        assert_eq!(id3, "adverb-adjective-noun003");
    }
}
