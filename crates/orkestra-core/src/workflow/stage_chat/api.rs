//! `WorkflowApi` methods for stage chat operations.

use std::sync::Arc;

use crate::workflow::api::WorkflowApi;
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
}
