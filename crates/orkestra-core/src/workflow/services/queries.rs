//! Read-only query operations.

use std::path::Path;

use crate::workflow::domain::{Iteration, LogEntry, Question};
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::{Artifact, Outcome};
use crate::workflow::services::session_logs::recover_session_logs;

use super::WorkflowApi;

impl WorkflowApi {
    /// Get pending questions for a task.
    pub fn get_pending_questions(&self, task_id: &str) -> WorkflowResult<Vec<Question>> {
        let task = self.get_task(task_id)?;
        Ok(task.pending_questions)
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

        let current_stage = match task.current_stage() {
            Some(s) => s,
            None => return Ok(None),
        };

        // Get iterations for current stage
        let iterations = self.store.get_iterations_for_stage(task_id, current_stage)?;

        // Find the most recent rejection or restage outcome
        for iteration in iterations.into_iter().rev() {
            match iteration.outcome {
                Some(Outcome::Rejected { feedback, .. }) => {
                    return Ok(Some(feedback));
                }
                Some(Outcome::Restage { feedback, .. }) => {
                    return Ok(Some(feedback));
                }
                _ => continue,
            }
        }

        Ok(None)
    }

    /// Check if a task has pending questions.
    pub fn has_pending_questions(&self, task_id: &str) -> WorkflowResult<bool> {
        let task = self.get_task(task_id)?;
        Ok(!task.pending_questions.is_empty())
    }

    /// Get the current stage name for a task.
    pub fn get_current_stage(&self, task_id: &str) -> WorkflowResult<Option<String>> {
        let task = self.get_task(task_id)?;
        Ok(task.current_stage().map(|s| s.to_string()))
    }

    /// Get all running agent processes.
    ///
    /// Returns tuples of (task_id, stage, pid) for all agents that have PIDs
    /// recorded in their stage sessions. Used for cleanup on shutdown/startup.
    pub fn get_running_agent_pids(&self) -> WorkflowResult<Vec<(String, String, u32)>> {
        let sessions = self.store.get_sessions_with_pids()?;
        Ok(sessions
            .into_iter()
            .filter_map(|s| s.agent_pid.map(|pid| (s.task_id, s.stage, pid)))
            .collect())
    }

    /// Clear the agent PID for a stage session.
    ///
    /// Used after killing an orphaned agent to remove the stale PID.
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
    /// Returns the names of stages that have a Claude session ID recorded,
    /// meaning they have session logs available.
    pub fn get_stages_with_logs(&self, task_id: &str) -> WorkflowResult<Vec<String>> {
        let sessions = self.store.get_stage_sessions(task_id)?;
        Ok(sessions
            .into_iter()
            .filter(|s| s.claude_session_id.is_some())
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
    /// Vec of LogEntry representing the session activity (tool uses, text output, etc.)
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

        // Get the stage session to find the Claude session ID
        let session = self.store.get_stage_session(task_id, &stage_name)?;
        let Some(session) = session else {
            return Ok(vec![]); // No session for this stage yet
        };
        let Some(claude_id) = session.claude_session_id else {
            return Ok(vec![]); // No Claude session ID captured yet
        };

        // Determine the working directory - use worktree if available, otherwise project root
        let cwd = task
            .worktree_path
            .as_ref()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| project_root.to_path_buf());

        // Recover logs from Claude's session file
        // Return empty if file doesn't exist yet (agent may still be starting)
        Ok(recover_session_logs(&claude_id, &cwd).unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::domain::Task;
    use crate::workflow::execution::StageOutput;
    use crate::workflow::runtime::Status;
    use crate::workflow::InMemoryWorkflowStore;

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

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.pending_questions = vec![Question::new("q1", "What framework?")];
        api.store.save_task(&task).unwrap();

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

        let mut task = api.create_task("Test", "Description", None).unwrap();
        assert!(!api.has_pending_questions(&task.id).unwrap());

        task.pending_questions = vec![Question::new("q1", "What framework?")];
        api.store.save_task(&task).unwrap();

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
}
