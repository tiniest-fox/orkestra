//! Task reset operations.
//!
//! Provides reset methods on `WorkflowApi` for clearing task state at various granularities:
//! - Current stage only (clear iteration, keep artifacts from prior stages)
//! - To a specific stage (clear all data from that stage forward)
//! - Full reset (return to initial state)
//!
//! All reset operations kill any active agent process before modifying data.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{ArtifactStore, Phase, Status};

use super::WorkflowApi;

impl WorkflowApi {
    /// Reset the current stage only.
    ///
    /// Kills any active agent for the task, clears the current iteration and current
    /// stage artifact, but preserves all artifacts from prior stages. Sets phase to Idle.
    pub fn reset_current_stage(&self, task_id: &str) -> WorkflowResult<Task> {
        // Kill any active agent first
        self.kill_agents_for_tasks(&[task_id.to_string()]);

        // Load task
        let mut task = self
            .store
            .get_task(task_id)?
            .ok_or_else(|| WorkflowError::TaskNotFound(task_id.to_string()))?;

        // Get current stage name
        let current_stage = match &task.status {
            Status::Active { stage } | Status::WaitingOnChildren { stage } => stage.clone(),
            Status::Done | Status::Archived => {
                return Err(WorkflowError::InvalidState(
                    "Cannot reset a completed or archived task".into(),
                ));
            }
            Status::Failed { .. } | Status::Blocked { .. } => {
                return Err(WorkflowError::InvalidState(
                    "Cannot reset a failed or blocked task".into(),
                ));
            }
        };

        // Delete current stage iteration
        self.store
            .delete_iterations_for_stage(task_id, &current_stage)?;

        // Delete current stage session
        self.store.delete_stage_session(task_id, &current_stage)?;

        // Get the stage config to find the artifact name
        if let Some(stage_config) = self.workflow.stage(&current_stage) {
            task.artifacts.remove(&stage_config.artifact);
        }

        // Set phase to Idle
        task.phase = Phase::Idle;
        task.updated_at = chrono::Utc::now().to_rfc3339();

        // Save and return
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Reset to a specific stage.
    ///
    /// Kills any active agent for the task, deletes all iterations, stage sessions, and
    /// artifacts from the specified stage forward. Sets status to Active(stage) and phase to Idle.
    ///
    /// Returns an error if the stage name is invalid for the task's flow.
    pub fn reset_to_stage(&self, task_id: &str, stage_name: &str) -> WorkflowResult<Task> {
        // Kill any active agent first
        self.kill_agents_for_tasks(&[task_id.to_string()]);

        // Load task
        let mut task = self
            .store
            .get_task(task_id)?
            .ok_or_else(|| WorkflowError::TaskNotFound(task_id.to_string()))?;

        // Validate stage exists in task's flow
        let flow = task.flow.as_deref();
        let stage_config = self
            .workflow
            .stage(stage_name)
            .ok_or_else(|| WorkflowError::InvalidState(format!("Invalid stage: {stage_name}")))?;

        // Check if stage is in the task's flow
        let stage_in_flow = if let Some(flow_name) = flow {
            if let Some(flow_config) = self.workflow.flows.get(flow_name) {
                flow_config
                    .stages
                    .iter()
                    .any(|e| e.stage_name == stage_name)
            } else {
                false
            }
        } else {
            // Default flow includes all stages
            true
        };

        if !stage_in_flow {
            let valid_stages = if let Some(flow_name) = flow {
                self.workflow
                    .flows
                    .get(flow_name)
                    .map(|f| {
                        f.stages
                            .iter()
                            .map(|e| e.stage_name.as_str())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            } else {
                self.workflow.stage_names()
            };

            return Err(WorkflowError::InvalidState(format!(
                "Stage '{}' is not in task's flow. Valid stages: {}",
                stage_name,
                valid_stages.join(", ")
            )));
        }

        // Collect stages from target stage forward
        let mut stages_to_clear = Vec::new();
        let mut current = Some(stage_config);

        while let Some(stage) = current {
            stages_to_clear.push(stage.name.clone());
            current = self.workflow.next_stage_in_flow(&stage.name, flow);
        }

        // Delete iterations and sessions for these stages
        for stage in &stages_to_clear {
            self.store.delete_iterations_for_stage(task_id, stage)?;
            self.store.delete_stage_session(task_id, stage)?;
        }

        // Remove artifacts for these stages
        for stage in &stages_to_clear {
            if let Some(stage_config) = self.workflow.stage(stage) {
                task.artifacts.remove(&stage_config.artifact);
            }
        }

        // Set task to the target stage
        task.status = Status::active(stage_name);
        task.phase = Phase::Idle;
        task.updated_at = chrono::Utc::now().to_rfc3339();

        // Save and return
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Full task reset.
    ///
    /// Kills any active agent for the task, deletes all iterations, stage sessions, and
    /// artifacts. Returns the task to the first stage with `AwaitingSetup` phase.
    pub fn reset_full(&self, task_id: &str) -> WorkflowResult<Task> {
        // Kill any active agent first
        self.kill_agents_for_tasks(&[task_id.to_string()]);

        // Load task
        let mut task = self
            .store
            .get_task(task_id)?
            .ok_or_else(|| WorkflowError::TaskNotFound(task_id.to_string()))?;

        // Delete all iterations
        self.store.delete_iterations(task_id)?;

        // Delete all stage sessions
        self.store.delete_stage_sessions(task_id)?;

        // Clear all artifacts
        task.artifacts = ArtifactStore::default();

        // Get first stage in flow
        let flow = task.flow.as_deref();
        let first_stage = self.workflow.first_stage_in_flow(flow).ok_or_else(|| {
            WorkflowError::InvalidState(format!("No first stage found for flow: {flow:?}"))
        })?;

        // Reset to first stage with AwaitingSetup phase
        task.status = Status::active(first_stage.name.clone());
        task.phase = Phase::AwaitingSetup;
        task.updated_at = chrono::Utc::now().to_rfc3339();

        // Save and return
        self.store.save_task(&task)?;
        Ok(task)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::WorkflowConfig;
    use crate::workflow::ports::WorkflowStore;
    use crate::workflow::runtime::Artifact;
    use std::sync::Arc;

    fn setup_test_api() -> (
        WorkflowApi,
        Arc<crate::workflow::adapters::InMemoryWorkflowStore>,
    ) {
        let workflow = WorkflowConfig::default();
        let store = Arc::new(crate::workflow::adapters::InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store.clone());
        (api, store)
    }

    #[test]
    fn test_reset_current_stage() {
        let (api, store) = setup_test_api();

        // Create a task in work stage with an artifact
        let mut task = Task::new(
            "task-1",
            "Test",
            "Desc",
            "work",
            chrono::Utc::now().to_rfc3339(),
        );
        task.status = Status::active("work");
        task.phase = Phase::AgentWorking;
        task.artifacts.set(Artifact::new(
            "summary",
            "Work output",
            "work",
            chrono::Utc::now().to_rfc3339(),
        ));
        task.artifacts.set(Artifact::new(
            "plan",
            "Plan output",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        ));
        store.save_task(&task).unwrap();

        // Reset current stage
        let reset_task = api.reset_current_stage("task-1").unwrap();

        // Should clear work artifact but keep plan
        assert!(reset_task.artifacts.get("summary").is_none());
        assert!(reset_task.artifacts.get("plan").is_some());
        assert_eq!(reset_task.phase, Phase::Idle);
        assert_eq!(reset_task.status, Status::active("work"));
    }

    #[test]
    fn test_reset_to_stage() {
        let (api, store) = setup_test_api();

        // Create a task in review stage with multiple artifacts
        let mut task = Task::new(
            "task-1",
            "Test",
            "Desc",
            "review",
            chrono::Utc::now().to_rfc3339(),
        );
        task.status = Status::active("review");
        task.artifacts.set(Artifact::new(
            "plan",
            "Plan output",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        ));
        task.artifacts.set(Artifact::new(
            "summary",
            "Work output",
            "work",
            chrono::Utc::now().to_rfc3339(),
        ));
        task.artifacts.set(Artifact::new(
            "verdict",
            "Review output",
            "review",
            chrono::Utc::now().to_rfc3339(),
        ));
        store.save_task(&task).unwrap();

        // Reset to work stage
        let reset_task = api.reset_to_stage("task-1", "work").unwrap();

        // Should keep plan, clear work and review artifacts
        assert!(reset_task.artifacts.get("plan").is_some());
        assert!(reset_task.artifacts.get("summary").is_none());
        assert!(reset_task.artifacts.get("verdict").is_none());
        assert_eq!(reset_task.status, Status::active("work"));
        assert_eq!(reset_task.phase, Phase::Idle);
    }

    #[test]
    fn test_reset_full() {
        let (api, store) = setup_test_api();

        // Create a task in review stage with all artifacts
        let mut task = Task::new(
            "task-1",
            "Test",
            "Desc",
            "review",
            chrono::Utc::now().to_rfc3339(),
        );
        task.status = Status::active("review");
        task.artifacts.set(Artifact::new(
            "plan",
            "Plan output",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        ));
        task.artifacts.set(Artifact::new(
            "summary",
            "Work output",
            "work",
            chrono::Utc::now().to_rfc3339(),
        ));
        store.save_task(&task).unwrap();

        // Full reset
        let reset_task = api.reset_full("task-1").unwrap();

        // Should clear all artifacts and return to first stage
        assert!(reset_task.artifacts.is_empty());
        assert_eq!(reset_task.status, Status::active("planning"));
        assert_eq!(reset_task.phase, Phase::AwaitingSetup);
    }

    #[test]
    fn test_reset_invalid_stage() {
        let (api, store) = setup_test_api();

        let task = Task::new(
            "task-1",
            "Test",
            "Desc",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        store.save_task(&task).unwrap();

        // Try to reset to invalid stage
        let result = api.reset_to_stage("task-1", "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_reset_completed_task() {
        let (api, store) = setup_test_api();

        let mut task = Task::new(
            "task-1",
            "Test",
            "Desc",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        task.status = Status::Done;
        store.save_task(&task).unwrap();

        // Cannot reset completed task
        let result = api.reset_current_stage("task-1");
        assert!(result.is_err());
    }
}
