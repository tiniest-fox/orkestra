//! `WorkflowApi` methods for stage chat operations.

use std::sync::Arc;

use crate::workflow::api::WorkflowApi;
#[cfg(feature = "testutil")]
use crate::workflow::execution::get_agent_schema;
use crate::workflow::ports::{WorkflowError, WorkflowResult};

use super::interactions;

impl WorkflowApi {
    /// Send a chat message to the stage agent.
    ///
    /// Valid when the task is in `AwaitingApproval`, `AwaitingQuestionAnswer`,
    /// `AwaitingRejectionConfirmation`, or `Interrupted` phase.
    /// Requires `with_provider_registry()` and `with_project_root()` to be set.
    pub fn send_chat_message(&self, task_id: &str, message: &str) -> WorkflowResult<()> {
        let registry = self.provider_registry.as_ref().ok_or_else(|| {
            WorkflowError::InvalidState("No provider registry configured for chat".into())
        })?;
        let project_root = self.project_root.as_ref().ok_or_else(|| {
            WorkflowError::InvalidState("No project root configured for chat".into())
        })?;

        interactions::send_message::execute(
            Arc::clone(&self.store),
            registry,
            &self.workflow,
            project_root,
            task_id,
            message,
        )
    }

    /// Kill the running chat agent process for a task.
    ///
    /// Clears the agent PID but does not exit chat mode. Call `return_to_work`
    /// to exit chat mode and create a new iteration.
    pub fn kill_chat_agent(&self, task_id: &str) -> WorkflowResult<()> {
        interactions::kill_agent::execute(self.store.as_ref(), task_id)
    }

    /// Try to detect structured output in accumulated chat text and complete the stage (test-only).
    ///
    /// Used in e2e tests to exercise the detection logic directly without spawning a real
    /// chat agent. The schema is computed from the workflow config for the given stage.
    #[cfg(feature = "testutil")]
    pub fn detect_chat_completion(
        &self,
        task_id: &str,
        stage: &str,
        task_flow: &str,
        accumulated_text: &str,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let effective_stage = self
            .workflow
            .stage(task_flow, stage)
            .ok_or_else(|| format!("Unknown stage: {stage}"))?
            .clone();
        let schema_str = get_agent_schema(&effective_stage, self.project_root.as_deref(), &[])
            .ok_or_else(|| format!("No schema for stage: {stage}"))?;
        let schema: serde_json::Value = serde_json::from_str(&schema_str)
            .map_err(|e| format!("Generated schema is not valid JSON: {e}"))?;

        interactions::try_complete_from_output::execute(
            &self.store,
            &self.workflow,
            &schema,
            task_id,
            stage,
            accumulated_text,
        )
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
    }
}
