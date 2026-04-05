//! Read-only query operations.

use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::task_view::TaskView;
use crate::workflow::domain::{Iteration, LogEntry, Question, StageSession};
use crate::workflow::ports::{SyncStatus, WorkflowError, WorkflowResult};
use crate::workflow::runtime::Artifact;

use super::interactions as query;

impl WorkflowApi {
    /// Get pending questions for a task.
    pub fn get_pending_questions(&self, task_id: &str) -> WorkflowResult<Vec<Question>> {
        query::questions::get_pending(self.store.as_ref(), task_id)
    }

    /// Get a specific artifact by name.
    pub fn get_artifact(&self, task_id: &str, name: &str) -> WorkflowResult<Option<Artifact>> {
        query::artifacts::get_artifact(self.store.as_ref(), task_id, name)
    }

    /// Get all iterations for a task.
    pub fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
        query::iterations::get_all(self.store.as_ref(), task_id)
    }

    /// Get the latest iteration for a specific stage.
    pub fn get_latest_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>> {
        query::iterations::get_latest(self.store.as_ref(), task_id, stage)
    }

    /// Get feedback from the last rejection for the current stage.
    pub fn get_rejection_feedback(&self, task_id: &str) -> WorkflowResult<Option<String>> {
        query::iterations::get_rejection_feedback(self.store.as_ref(), task_id)
    }

    /// Check if a task has pending questions.
    pub fn has_pending_questions(&self, task_id: &str) -> WorkflowResult<bool> {
        query::questions::has_pending(self.store.as_ref(), task_id)
    }

    /// Get the current stage name for a task.
    pub fn get_current_stage(&self, task_id: &str) -> WorkflowResult<Option<String>> {
        query::artifacts::get_current_stage(self.store.as_ref(), task_id)
    }

    /// List all active top-level tasks with pre-joined data and derived state.
    pub fn list_task_views(&self) -> WorkflowResult<Vec<TaskView>> {
        query::task_views::list_active(&self.store)
    }

    /// List subtasks for a parent task with pre-joined data and derived state.
    pub fn list_subtask_views(&self, parent_id: &str) -> WorkflowResult<Vec<TaskView>> {
        query::task_views::list_subtasks(self.store.as_ref(), parent_id)
    }

    /// List all archived top-level tasks with pre-joined data and derived state.
    pub fn list_archived_task_views(&self) -> WorkflowResult<Vec<TaskView>> {
        query::task_views::list_archived(&self.store)
    }

    /// Get a specific stage session for a task.
    pub fn get_stage_session(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<StageSession>> {
        query::sessions::get_stage_session(self.store.as_ref(), task_id, stage)
    }

    /// Get all stage sessions for a task.
    pub fn get_stage_sessions(&self, task_id: &str) -> WorkflowResult<Vec<StageSession>> {
        query::sessions::get_stage_sessions(self.store.as_ref(), task_id)
    }

    /// Get all running agent processes as (`task_id`, stage, pid) tuples.
    pub fn get_running_agent_pids(&self) -> WorkflowResult<Vec<(String, String, u32)>> {
        query::sessions::get_running_agent_pids(self.store.as_ref())
    }

    /// Clear the `claude_session_id` for a stage session (test-only).
    #[cfg(feature = "testutil")]
    pub fn clear_session_id(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.claude_session_id = None;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Set the `claude_session_id` for a stage session (test-only).
    ///
    /// Mock agents don't emit `SessionId` events so `claude_session_id` is always `None`
    /// after agent execution in tests. Use this to inject a fake session ID when the
    /// test needs `send_message` to succeed (chat requires `--resume` with a session ID).
    #[cfg(feature = "testutil")]
    pub fn set_session_id(
        &self,
        task_id: &str,
        stage: &str,
        session_id: &str,
    ) -> WorkflowResult<()> {
        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.claude_session_id = Some(session_id.to_string());
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Clear the agent PID for a stage session after an orphaned agent is killed.
    pub fn clear_session_agent_pid(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.agent_pid = None;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Get sync status for a task's branch relative to origin.
    ///
    /// Validates the task is Done with an open PR before querying git.
    pub fn task_sync_status(&self, task_id: &str) -> WorkflowResult<Option<SyncStatus>> {
        let git = self
            .git_service()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        query::task_sync_status::execute(self.store.as_ref(), git.as_ref(), task_id)
    }

    /// Get stages that have logs for a task.
    pub fn get_stages_with_logs(&self, task_id: &str) -> WorkflowResult<Vec<String>> {
        query::logs::get_stages_with_logs(&self.store, task_id)
    }

    /// Get the most recent log entry for the task's current stage session.
    ///
    /// Returns `None` if the task has no current stage, no session for the
    /// stage, or the session has no log entries.
    pub fn get_latest_log(&self, task_id: &str) -> WorkflowResult<Option<LogEntry>> {
        query::logs::get_latest_log_for_task(&self.store, task_id)
    }

    /// Get log entries for a task's stage or a specific session.
    ///
    /// If `session_id` is provided, fetch logs for that specific session.
    /// Otherwise, if `stage` is provided, fetch logs for the current session of that stage.
    /// If neither is provided, fetch logs for the current stage's current session.
    pub fn get_task_logs(
        &self,
        task_id: &str,
        stage: Option<&str>,
        session_id: Option<&str>,
    ) -> WorkflowResult<Vec<LogEntry>> {
        query::logs::get_task_logs(&self.store, task_id, stage, session_id)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::domain::{Question, Task};
    use crate::workflow::execution::StageOutput;
    use crate::workflow::query::interactions::task_views::topological_sort;
    use crate::workflow::runtime::{Outcome, TaskState};
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

    use super::*;

    /// Create a task ready for agent work (in Idle phase).
    fn create_task_ready(api: &WorkflowApi, title: &str, desc: &str) -> Task {
        let mut task = api.create_task(title, desc, None).unwrap();
        task.state = TaskState::queued("planning");
        api.store.save_task(&task).unwrap();
        task
    }

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary"),
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
        api.agent_started(&task.id).unwrap();
        let _ = api
            .process_agent_output(
                &task.id,
                StageOutput::Artifact {
                    content: "The plan".to_string(),
                    activity_log: None,
                    resources: vec![],
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
        api.agent_started(&task.id).unwrap();
        let task = api
            .process_agent_output(
                &task.id,
                StageOutput::Artifact {
                    content: "Plan v1".to_string(),
                    activity_log: None,
                    resources: vec![],
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
        done_task.state = TaskState::Done;
        api.store.save_task(&done_task).unwrap();

        assert_eq!(api.get_current_stage(&done_task.id).unwrap(), None);
    }

    #[test]
    fn test_clear_session_agent_pid_preserves_spawn_count() {
        use crate::workflow::domain::StageSession;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        let mut session = StageSession::new(
            format!("{}-planning", task.id),
            &task.id,
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        session.agent_pid = Some(12345);
        session.spawn_count = 1;
        api.store.save_stage_session(&session).unwrap();

        let session_before = api
            .store
            .get_stage_session(&task.id, "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session_before.agent_pid, Some(12345));
        assert_eq!(session_before.spawn_count, 1);

        api.clear_session_agent_pid(&task.id, "planning").unwrap();

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

    #[test]
    fn test_topological_sort_diamond() {
        let a = Task::new("a", "A", "", "work", "now");
        let mut b = Task::new("b", "B", "", "work", "now");
        b.depends_on = vec!["a".into()];
        let mut c = Task::new("c", "C", "", "work", "now");
        c.depends_on = vec!["a".into()];
        let mut d = Task::new("d", "D", "", "work", "now");
        d.depends_on = vec!["b".into(), "c".into()];

        let sorted = topological_sort(vec![d, c, b, a]);
        let ids: Vec<&str> = sorted.iter().map(|t| t.id.as_str()).collect();

        let pos = |id: &str| ids.iter().position(|&x| x == id).unwrap();
        assert!(pos("a") < pos("b"));
        assert!(pos("a") < pos("c"));
        assert!(pos("b") < pos("d"));
        assert!(pos("c") < pos("d"));
    }

    #[test]
    fn test_topological_sort_no_deps() {
        let a = Task::new("a", "A", "", "work", "now");
        let b = Task::new("b", "B", "", "work", "now");
        let c = Task::new("c", "C", "", "work", "now");

        let sorted = topological_sort(vec![a, b, c]);
        let ids: Vec<&str> = sorted.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_topological_sort_linear_chain() {
        let a = Task::new("a", "A", "", "work", "now");
        let mut b = Task::new("b", "B", "", "work", "now");
        b.depends_on = vec!["a".into()];
        let mut c = Task::new("c", "C", "", "work", "now");
        c.depends_on = vec!["b".into()];

        let sorted = topological_sort(vec![c, b, a]);
        let ids: Vec<&str> = sorted.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_list_archived_task_views() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::Archived;
        api.store.save_task(&task).unwrap();

        let archived_views = api.list_archived_task_views().unwrap();
        assert_eq!(archived_views.len(), 1);
        assert_eq!(archived_views[0].task.id, task.id);
        assert!(archived_views[0].derived.is_archived);

        let active_views = api.list_task_views().unwrap();
        assert_eq!(active_views.len(), 0);
    }
}
