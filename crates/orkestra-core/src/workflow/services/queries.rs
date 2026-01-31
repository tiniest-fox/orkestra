//! Read-only query operations.

use std::collections::HashMap;
use std::path::Path;

use crate::workflow::domain::task_view::{DerivedTaskState, TaskView};
use crate::workflow::domain::{Iteration, LogEntry, Question, StageSession};
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::{Artifact, Outcome};

use super::log_service::LogService;
use super::WorkflowApi;

/// Trait for types that belong to a task (have a `task_id` field).
trait HasTaskId {
    fn task_id(&self) -> &str;
}

impl HasTaskId for Iteration {
    fn task_id(&self) -> &str {
        &self.task_id
    }
}

impl HasTaskId for StageSession {
    fn task_id(&self) -> &str {
        &self.task_id
    }
}

/// Group a flat list of items by their task ID.
fn group_by_task_id<T: HasTaskId>(items: Vec<T>) -> HashMap<String, Vec<T>> {
    let mut map: HashMap<String, Vec<T>> = HashMap::new();
    for item in items {
        map.entry(item.task_id().to_string())
            .or_default()
            .push(item);
    }
    map
}

impl WorkflowApi {
    /// Get pending questions for a task.
    ///
    /// Reads questions from the latest iteration's outcome.
    pub fn get_pending_questions(&self, task_id: &str) -> WorkflowResult<Vec<Question>> {
        let task = self.get_task(task_id)?;

        // Get questions from iteration outcome
        if let Some(stage) = task.current_stage() {
            if let Some(iter) = self.store.get_latest_iteration(task_id, stage)? {
                if let Some(Outcome::AwaitingAnswers { questions, .. }) = &iter.outcome {
                    return Ok(questions.clone());
                }
            }
        }

        Ok(vec![])
    }

    /// Get a specific artifact by name.
    pub fn get_artifact(&self, task_id: &str, name: &str) -> WorkflowResult<Option<Artifact>> {
        let task = self.get_task(task_id)?;
        Ok(task.artifacts.get(name).cloned())
    }

    /// Get all iterations for a task.
    pub fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
        self.store.get_iterations(task_id)
    }

    /// Get the latest iteration for a specific stage.
    pub fn get_latest_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>> {
        self.store.get_latest_iteration(task_id, stage)
    }

    /// Get feedback from the last rejection (for agent prompts).
    ///
    /// Returns the feedback from the most recent `Rejected` or `Restage` outcome
    /// for the task's current stage, if any.
    pub fn get_rejection_feedback(&self, task_id: &str) -> WorkflowResult<Option<String>> {
        let task = self.get_task(task_id)?;

        let Some(current_stage) = task.current_stage() else {
            return Ok(None);
        };

        // Get iterations for current stage
        let iterations = self
            .store
            .get_iterations_for_stage(task_id, current_stage)?;

        // Find the most recent rejection or restage outcome
        for iteration in iterations.into_iter().rev() {
            if let Some(Outcome::Rejected { feedback, .. } | Outcome::Restage { feedback, .. }) =
                iteration.outcome
            {
                return Ok(Some(feedback));
            }
        }

        Ok(None)
    }

    /// Check if a task has pending questions.
    pub fn has_pending_questions(&self, task_id: &str) -> WorkflowResult<bool> {
        let questions = self.get_pending_questions(task_id)?;
        Ok(!questions.is_empty())
    }

    /// Get the current stage name for a task.
    pub fn get_current_stage(&self, task_id: &str) -> WorkflowResult<Option<String>> {
        let task = self.get_task(task_id)?;
        Ok(task.current_stage().map(std::string::ToString::to_string))
    }

    /// List all active top-level tasks with pre-joined data and derived state.
    ///
    /// Enriches each task with its iterations, stage sessions, and a `DerivedTaskState`
    /// computed from the task's domain predicates. This lets the frontend render
    /// everything without additional queries.
    pub fn list_task_views(&self) -> WorkflowResult<Vec<TaskView>> {
        let tasks = self.list_tasks()?;

        // Batch-load all iterations and sessions in 2 queries (not 2N)
        let mut iterations_by_task = group_by_task_id(self.store.list_all_iterations()?);
        let mut sessions_by_task = group_by_task_id(self.store.list_all_stage_sessions()?);

        let mut views = Vec::with_capacity(tasks.len());
        for task in tasks {
            let iterations = iterations_by_task.remove(&task.id).unwrap_or_default();
            let stage_sessions = sessions_by_task.remove(&task.id).unwrap_or_default();
            let derived = DerivedTaskState::build(&task, &iterations, &stage_sessions);

            views.push(TaskView {
                task,
                iterations,
                stage_sessions,
                derived,
            });
        }

        Ok(views)
    }

    /// Get a specific stage session for a task.
    pub fn get_stage_session(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<StageSession>> {
        self.store.get_stage_session(task_id, stage)
    }

    /// Get all stage sessions for a task.
    pub fn get_stage_sessions(&self, task_id: &str) -> WorkflowResult<Vec<StageSession>> {
        self.store.get_stage_sessions(task_id)
    }

    /// Get all running agent processes.
    ///
    /// Returns tuples of (`task_id`, stage, pid) for all agents that have PIDs
    /// recorded in their stage sessions. Used for cleanup on shutdown/startup.
    pub fn get_running_agent_pids(&self) -> WorkflowResult<Vec<(String, String, u32)>> {
        let sessions = self.store.get_sessions_with_pids()?;
        Ok(sessions
            .into_iter()
            .filter_map(|s| s.agent_pid.map(|pid| (s.task_id, s.stage, pid)))
            .collect())
    }

    /// Clear the agent PID for a stage session after an orphaned agent is killed.
    ///
    /// Only clears the PID. The `spawn_count` was already incremented when
    /// the agent was spawned, so the next spawn will correctly use `--resume`.
    pub fn clear_session_agent_pid(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.agent_pid = None;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Get stages that have logs for a task.
    ///
    /// Returns the names of stages that have logs available:
    /// - Agent stages with a Claude session ID
    /// - Script stages with a log file in `.orkestra/script_logs/`
    pub fn get_stages_with_logs(
        &self,
        task_id: &str,
        project_root: &Path,
    ) -> WorkflowResult<Vec<String>> {
        let sessions = self.store.get_stage_sessions(task_id)?;
        let log_service = LogService::new(self.workflow.clone(), project_root.to_path_buf());

        Ok(sessions
            .into_iter()
            .filter(|s| {
                log_service.stage_has_logs(task_id, &s.stage, s.claude_session_id.as_deref())
            })
            .map(|s| s.stage)
            .collect())
    }

    /// Get session logs for a task.
    ///
    /// Retrieves parsed log entries from the Claude Code session file associated with
    /// the task's current (or specified) stage session.
    ///
    /// # Arguments
    /// * `task_id` - The task ID
    /// * `stage` - Optional stage name. If None, uses the task's current stage.
    /// * `project_root` - The project root directory (fallback if no worktree)
    ///
    /// # Returns
    /// Vec of `LogEntry` representing the session activity (tool uses, text output, etc.)
    pub fn get_task_logs(
        &self,
        task_id: &str,
        stage: Option<&str>,
        project_root: &Path,
    ) -> WorkflowResult<Vec<LogEntry>> {
        let task = self.get_task(task_id)?;

        // Determine which stage to get logs for
        let stage_name = match stage {
            Some(s) => s.to_string(),
            None => match task.current_stage() {
                Some(s) => s.to_string(),
                None => return Ok(vec![]), // Terminal state, no active stage
            },
        };

        // Get the Claude session ID if this is an agent stage
        let claude_session_id = self
            .store
            .get_stage_session(task_id, &stage_name)?
            .and_then(|s| s.claude_session_id);

        // Use LogService for unified log reading
        let log_service = LogService::new(self.workflow.clone(), project_root.to_path_buf());
        Ok(log_service.get_logs(&task, &stage_name, claude_session_id.as_deref()))
    }
}

#[cfg(test)]
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::domain::Task;
    use crate::workflow::execution::StageOutput;
    use crate::workflow::runtime::Status;
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;
    use std::time::Duration;

    use super::*;

    /// Create a task and wait for async setup to complete.
    fn create_task_ready(api: &WorkflowApi, title: &str, desc: &str) -> Task {
        let task = api.create_task(title, desc, None).unwrap();
        std::thread::sleep(Duration::from_millis(10));
        api.get_task(&task.id).unwrap()
    }

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
        ])
    }

    #[test]
    fn test_get_pending_questions() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        // Simulate agent asking questions via iteration outcome
        let iter = api
            .store
            .get_latest_iteration(&task.id, "planning")
            .unwrap()
            .unwrap();
        let mut iter = iter;
        iter.outcome = Some(Outcome::awaiting_answers(
            "planning",
            vec![Question::new("What framework?")],
        ));
        iter.ended_at = Some(chrono::Utc::now().to_rfc3339());
        api.store.save_iteration(&iter).unwrap();

        let questions = api.get_pending_questions(&task.id).unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "What framework?");
    }

    #[test]
    fn test_get_artifact() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();
        let _ = api
            .process_agent_output(
                &task.id,
                StageOutput::Artifact {
                    content: "The plan".to_string(),
                },
            )
            .unwrap();

        let artifact = api.get_artifact(&task.id, "plan").unwrap();
        assert!(artifact.is_some());
        assert_eq!(artifact.unwrap().content, "The plan");

        let missing = api.get_artifact(&task.id, "nonexistent").unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn test_get_iterations() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();
        assert_eq!(iterations.len(), 1);
        assert_eq!(iterations[0].stage, "planning");
    }

    #[test]
    fn test_get_latest_iteration() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        let latest = api.get_latest_iteration(&task.id, "planning").unwrap();
        assert!(latest.is_some());
        assert_eq!(latest.unwrap().stage, "planning");

        let missing = api.get_latest_iteration(&task.id, "work").unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn test_get_rejection_feedback() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");

        // Initially no feedback
        let feedback = api.get_rejection_feedback(&task.id).unwrap();
        assert!(feedback.is_none());

        // Simulate producing artifact and getting rejected
        let task = api.agent_started(&task.id).unwrap();
        let task = api
            .process_agent_output(
                &task.id,
                StageOutput::Artifact {
                    content: "Plan v1".to_string(),
                },
            )
            .unwrap();
        let _ = api.reject(&task.id, "Please add more detail").unwrap();

        // Now should have feedback
        let feedback = api.get_rejection_feedback(&task.id).unwrap();
        assert_eq!(feedback, Some("Please add more detail".to_string()));
    }

    #[test]
    fn test_has_pending_questions() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        assert!(!api.has_pending_questions(&task.id).unwrap());

        // Simulate agent asking questions via iteration outcome
        let iter = api
            .store
            .get_latest_iteration(&task.id, "planning")
            .unwrap()
            .unwrap();
        let mut iter = iter;
        iter.outcome = Some(Outcome::awaiting_answers(
            "planning",
            vec![Question::new("What framework?")],
        ));
        iter.ended_at = Some(chrono::Utc::now().to_rfc3339());
        api.store.save_iteration(&iter).unwrap();

        assert!(api.has_pending_questions(&task.id).unwrap());
    }

    #[test]
    fn test_get_current_stage() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        assert_eq!(
            api.get_current_stage(&task.id).unwrap(),
            Some("planning".to_string())
        );

        let mut done_task = api.create_task("Done", "Done task", None).unwrap();
        done_task.status = Status::Done;
        api.store.save_task(&done_task).unwrap();

        assert_eq!(api.get_current_stage(&done_task.id).unwrap(), None);
    }

    #[test]
    fn test_clear_session_agent_pid_preserves_spawn_count() {
        // This test verifies crash recovery works correctly:
        // spawn_count is incremented at spawn time, so even if an agent
        // crashes (and we just clear the PID), the next spawn sees
        // spawn_count > 0 and uses --resume.

        use crate::workflow::domain::StageSession;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        // Simulate a session with a running agent that was spawned
        // (spawn_count = 1 because it was incremented at spawn time)
        let mut session = StageSession::new(
            format!("{}-planning", task.id),
            &task.id,
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        session.agent_pid = Some(12345);
        session.spawn_count = 1; // Incremented when agent was spawned
        api.store.save_stage_session(&session).unwrap();

        // Verify initial state
        let session_before = api
            .store
            .get_stage_session(&task.id, "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session_before.agent_pid, Some(12345));
        assert_eq!(session_before.spawn_count, 1);

        // Simulate orphan cleanup: kill process and clear PID
        api.clear_session_agent_pid(&task.id, "planning").unwrap();

        // Verify: PID is cleared, spawn_count preserved (still > 0)
        let session_after = api
            .store
            .get_stage_session(&task.id, "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session_after.agent_pid, None, "PID should be cleared");
        assert_eq!(
            session_after.spawn_count, 1,
            "spawn_count should be preserved so next spawn uses --resume"
        );
    }
}
