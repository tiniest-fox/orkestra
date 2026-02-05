//! Agent execution service.
//!
//! This service executes agent instances for workflow stages. It ties together:
//! - `PromptService`: for building agent prompts
//! - `AgentRunner`: for running the actual agent process
//! - `ProviderRegistry`: for resolving model specs and checking provider capabilities
//!
//! When a provider doesn't support native JSON schema enforcement (e.g., `OpenCode`),
//! this service appends a schema enforcement section to the prompt so the agent
//! knows the expected output format.
//!
//! Session lifecycle (creation, PID recording) is managed by `StageExecutionService`.
//! This service receives pre-created session context and focuses purely on execution.
//!
//! This is one of the execution backends used by `StageExecutionService`.
//! For script execution, see `ScriptExecutionService`.

use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::execution::{
    build_resume_prompt, AgentConfigError, AgentRunnerTrait, ProviderRegistry, RegistryError,
    ResumeQuestionAnswer, ResumeType, RunConfig, RunError, RunEvent,
};

use super::prompt_service::PromptService;
use super::session_service::SessionSpawnContext;

// ============================================================================
// Execution Handle
// ============================================================================

/// Handle to a running task execution.
///
/// The orchestrator polls the event receiver to process execution events.
pub struct ExecutionHandle {
    /// Task being executed.
    pub task_id: String,
    /// Stage being executed.
    pub stage: String,
    /// Process ID of the agent.
    pub pid: u32,
    /// Event receiver for execution progress.
    pub events: Receiver<RunEvent>,
}

// ============================================================================
// Execution Error
// ============================================================================

/// Errors that can occur during agent execution.
#[derive(Debug, Clone)]
#[allow(clippy::enum_variant_names)] // Error suffix is intentional for clarity
pub enum ExecutionError {
    /// Failed to resolve agent configuration.
    ConfigError(String),
    /// Failed to run the agent.
    RunError(String),
}

impl std::fmt::Display for ExecutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConfigError(msg) => write!(f, "Config error: {msg}"),
            Self::RunError(msg) => write!(f, "Run error: {msg}"),
        }
    }
}

impl std::error::Error for ExecutionError {}

impl From<AgentConfigError> for ExecutionError {
    fn from(err: AgentConfigError) -> Self {
        Self::ConfigError(err.to_string())
    }
}

impl From<RunError> for ExecutionError {
    fn from(err: RunError) -> Self {
        Self::RunError(err.to_string())
    }
}

impl From<RegistryError> for ExecutionError {
    fn from(err: RegistryError) -> Self {
        Self::ConfigError(err.to_string())
    }
}

// ============================================================================
// Schema Enforcement
// ============================================================================

const SCHEMA_ENFORCEMENT_TEMPLATE: &str =
    include_str!("../../prompts/templates/schema_enforcement.md");

/// Append a schema enforcement section to a prompt for providers that don't
/// support native `--json-schema` enforcement.
///
/// The section instructs the agent to output valid JSON matching the schema.
fn append_schema_enforcement(prompt: &str, json_schema: &str) -> String {
    let rendered = handlebars::Handlebars::new()
        .render_template(
            SCHEMA_ENFORCEMENT_TEMPLATE,
            &serde_json::json!({ "json_schema": json_schema }),
        )
        .expect("schema_enforcement template should render");
    format!("{prompt}\n\n{rendered}")
}

// ============================================================================
// Agent Execution Service
// ============================================================================

/// Service for executing agent instances across different providers.
///
/// This service handles the specifics of running agent processes:
/// 1. Resolves the provider for the stage's model spec
/// 2. Builds the prompt from task context
/// 3. Appends schema enforcement to the prompt if the provider lacks native support
/// 4. Configures session ID for resume support
/// 5. Runs the agent process
/// 6. Returns a handle for polling completion
///
/// Session lifecycle (creation, PID recording) is managed by `StageExecutionService`.
/// This service receives pre-created session context and focuses purely on execution.
pub struct AgentExecutionService {
    /// Agent runner for executing agent processes.
    runner: Arc<dyn AgentRunnerTrait>,
    /// Prompt building service.
    prompt_service: PromptService,
    /// Workflow configuration.
    workflow: WorkflowConfig,
    /// Provider registry for resolving model specs to capabilities.
    registry: Arc<ProviderRegistry>,
}

impl AgentExecutionService {
    /// Create a new agent execution service.
    pub fn new(
        runner: Arc<dyn AgentRunnerTrait>,
        workflow: WorkflowConfig,
        project_root: PathBuf,
        registry: Arc<ProviderRegistry>,
    ) -> Self {
        Self {
            runner,
            prompt_service: PromptService::new(project_root),
            workflow,
            registry,
        }
    }

    /// Build the prompt for a stage execution.
    ///
    /// If resuming, returns a short resume prompt. Otherwise returns the full
    /// prompt with agent definition and task context.
    fn build_stage_prompt(
        &self,
        task: &Task,
        stage: &str,
        is_resume: bool,
        is_stage_reentry: bool,
        trigger: Option<&IterationTrigger>,
        show_direct_structured_output_hint: bool,
    ) -> Result<String, ExecutionError> {
        if is_resume {
            let resume_type = if is_stage_reentry {
                ResumeType::Recheck
            } else {
                trigger_to_resume_type(trigger)
            };
            build_resume_prompt(stage, &resume_type).map_err(ExecutionError::from)
        } else {
            let config = self.prompt_service.resolve_config(
                &self.workflow,
                task,
                None, // No feedback on first spawn
                None, // No integration error on first spawn
                show_direct_structured_output_hint,
            )?;
            Ok(config.prompt)
        }
    }

    /// Get the working directory for a task.
    fn get_working_dir(&self, task: &Task) -> PathBuf {
        task.worktree_path.as_ref().map_or_else(
            || self.prompt_service.project_root().to_path_buf(),
            PathBuf::from,
        )
    }

    /// Execute a stage for a task (async with events).
    ///
    /// This starts the agent and returns immediately with a handle.
    /// The caller should poll the handle's event receiver for progress.
    ///
    /// Session lifecycle (creation, PID recording) is handled by the caller
    /// (`StageExecutionService`). This method focuses purely on execution.
    ///
    /// # Arguments
    /// * `task` - The task to execute
    /// * `trigger` - Why this iteration was created (determines resume prompt type)
    /// * `spawn_context` - Pre-created session context from `StageExecutionService`
    pub fn execute_stage(
        &self,
        task: &Task,
        trigger: Option<&IterationTrigger>,
        spawn_context: &SessionSpawnContext,
    ) -> Result<ExecutionHandle, ExecutionError> {
        let stage = task
            .current_stage()
            .ok_or_else(|| ExecutionError::ConfigError("Task not in active stage".into()))?;

        orkestra_debug!(
            "exec",
            "execute_stage {}/{}: session_id={:?}, is_resume={}",
            task.id,
            stage,
            spawn_context.session_id,
            spawn_context.is_resume
        );

        // 1. Get JSON schema (needed for BOTH first spawn and resume)
        let stage_config = self
            .workflow
            .stage(stage)
            .ok_or_else(|| ExecutionError::ConfigError(format!("Unknown stage: {stage}")))?;

        // This method is for agent stages only - script stages are handled separately
        if stage_config.is_script_stage() {
            return Err(ExecutionError::ConfigError(format!(
                "Stage '{stage}' is a script stage, not an agent stage"
            )));
        }

        // Use effective capabilities from flow override if applicable
        let effective_config = if task.flow.is_some() {
            if let Some(caps) = self
                .workflow
                .effective_capabilities(stage, task.flow.as_deref())
            {
                let mut overridden = stage_config.clone();
                overridden.capabilities = caps;
                Some(overridden)
            } else {
                None
            }
        } else {
            None
        };
        let schema_stage = effective_config.as_ref().unwrap_or(stage_config);

        let json_schema = crate::workflow::execution::get_agent_schema(
            schema_stage,
            Some(self.prompt_service.project_root()),
        )
        .expect("Agent stage should have schema");

        // 2. Resolve the provider to check capabilities
        let model_spec = self.workflow.effective_model(stage, task.flow.as_deref());
        let resolved = self.registry.resolve(model_spec.as_deref())?;

        // 3. Build prompt based on whether this is a resume
        let mut prompt = self.build_stage_prompt(
            task,
            stage,
            spawn_context.is_resume,
            spawn_context.is_stage_reentry,
            trigger,
            resolved.capabilities.requires_direct_structured_output,
        )?;

        // 4. If the provider doesn't support native JSON schema, embed it in the prompt
        if !resolved.capabilities.supports_json_schema {
            orkestra_debug!(
                "exec",
                "execute_stage {}/{}: provider lacks native schema support, embedding in prompt",
                task.id,
                stage
            );
            prompt = append_schema_enforcement(&prompt, &json_schema);
        }

        orkestra_debug!(
            "exec",
            "execute_stage {}/{}: prompt len={}, is_resume={}",
            task.id,
            stage,
            prompt.len(),
            spawn_context.is_resume
        );

        // 5. Build run config with session info and model spec
        let working_dir = self.get_working_dir(task);

        let mut run_config =
            RunConfig::new(working_dir, prompt, json_schema).with_task_id(&task.id);

        // Only set session when we have a caller-provided session ID.
        // Providers that generate their own IDs (OpenCode) start without one.
        if let Some(ref sid) = spawn_context.session_id {
            run_config = run_config.with_session(sid.clone(), spawn_context.is_resume);
        }

        // Thread model spec from stage config (respects flow overrides)
        if let Some(model) = model_spec {
            run_config = run_config.with_model(model);
        }

        // 6. Run the agent
        let (pid, events) = self.runner.run_async(run_config)?;

        orkestra_debug!(
            "exec",
            "execute_stage {}/{}: spawned pid={}",
            task.id,
            stage,
            pid
        );

        Ok(ExecutionHandle {
            task_id: task.id.clone(),
            stage: stage.to_string(),
            pid,
            events,
        })
    }
}

/// Convert `IterationTrigger` to `ResumeType` for prompt building.
///
/// This maps the iteration context (stored in DB) to the prompt type (for agent).
fn trigger_to_resume_type(trigger: Option<&IterationTrigger>) -> ResumeType {
    match trigger {
        // First iteration or no special context
        None | Some(IterationTrigger::Interrupted) => ResumeType::Continue,
        Some(
            IterationTrigger::Feedback { feedback } | IterationTrigger::Rejection { feedback, .. },
        ) => ResumeType::Feedback {
            feedback: feedback.clone(),
        },
        Some(IterationTrigger::Integration {
            message,
            conflict_files,
        }) => ResumeType::Integration {
            message: message.clone(),
            conflict_files: conflict_files.clone(),
        },
        Some(IterationTrigger::Answers { answers }) => ResumeType::Answers {
            answers: answers
                .iter()
                .map(|qa| ResumeQuestionAnswer {
                    question: qa.question.clone(),
                    answer: qa.answer.clone(),
                })
                .collect(),
        },
        // Script failure is treated like feedback - agent needs to fix the issues
        Some(IterationTrigger::ScriptFailure { from_stage, error }) => ResumeType::Feedback {
            feedback: format!(
                "The automated checks in the '{from_stage}' stage failed:\n\n{error}"
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: Full integration tests would require mocking the ProcessSpawner
    // These tests verify the basic structure and error handling
    //
    // Session lifecycle tests are in session_service.rs since AgentExecutionService
    // no longer manages sessions (that's handled by StageExecutionService).

    #[test]
    fn test_execution_error_display() {
        let err = ExecutionError::ConfigError("test".into());
        assert!(err.to_string().contains("Config"));

        let err = ExecutionError::RunError("test".into());
        assert!(err.to_string().contains("Run"));
    }

    #[test]
    fn test_registry_error_converts_to_config_error() {
        let registry_err = RegistryError::UnknownProvider("badprovider".into());
        let exec_err = ExecutionError::from(registry_err);
        assert!(matches!(exec_err, ExecutionError::ConfigError(_)));
        assert!(exec_err.to_string().contains("badprovider"));
    }

    #[test]
    fn test_append_schema_enforcement() {
        let prompt = "Do the task";
        let schema = r#"{"type":"object","properties":{"result":{"type":"string"}}}"#;
        let result = append_schema_enforcement(prompt, schema);

        assert!(result.starts_with("Do the task"));
        assert!(result.contains("## Required Output Format"));
        assert!(result.contains(schema));
        assert!(result.contains("Output ONLY the JSON object"));
    }

    #[test]
    fn test_append_schema_enforcement_preserves_original_prompt() {
        let prompt = "Line 1\nLine 2\nLine 3";
        let schema = r#"{"type":"object"}"#;
        let result = append_schema_enforcement(prompt, schema);

        assert!(result.starts_with("Line 1\nLine 2\nLine 3\n"));
    }
}
