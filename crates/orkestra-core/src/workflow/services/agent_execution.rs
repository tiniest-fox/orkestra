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

use std::fmt::Write;
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::config::{DisallowedToolEntry, WorkflowConfig};
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::execution::{
    build_resume_prompt, ActivityLogEntry, AgentConfigError, AgentRunnerTrait, ProviderRegistry,
    RegistryError, ResumeQuestionAnswer, ResumeType, RunConfig, RunError, RunEvent,
};

use super::prompt_service::PromptService;
use super::session_service::SessionSpawnContext;

// ============================================================================
// Helper Types
// ============================================================================

/// Resolved stage parameters for building `RunConfig`.
///
/// Groups the prompt-related and provider-resolved values that flow through
/// `execute_stage` into `build_run_config`.
struct ResolvedStageParams {
    user_prompt: String,
    json_schema: String,
    system_prompt: Option<String>,
    model_spec: Option<String>,
    disallowed_tools: Vec<String>,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Extract feedback text from an iteration trigger.
///
/// Used by both `build_user_prompt` (for fresh spawns) and `execute_stage`
/// (for system prompt building). Centralizes the mapping from trigger variants
/// to their feedback/error text.
fn extract_feedback_text(trigger: Option<&IterationTrigger>) -> Option<&str> {
    trigger.and_then(|t| match t {
        IterationTrigger::Rejection { feedback, .. } | IterationTrigger::Feedback { feedback } => {
            Some(feedback.as_str())
        }
        IterationTrigger::ScriptFailure { error, .. } => Some(error.as_str()),
        IterationTrigger::RetryFailed { instructions }
        | IterationTrigger::RetryBlocked { instructions } => instructions.as_deref(),
        IterationTrigger::ManualResume { message } => message.as_deref(),
        _ => None,
    })
}

/// Format tool restrictions as a markdown section for injection into system prompt.
///
/// Returns a formatted string with a "## Tool Restrictions" header listing each
/// disallowed tool pattern with its explanation message.
fn format_tool_restrictions(tools: &[DisallowedToolEntry]) -> String {
    let mut restrictions = String::from(
        "\n\n## Tool Restrictions\n\nThe following tools are NOT available to you in this stage:\n",
    );
    for entry in tools {
        write!(
            restrictions,
            "\n- **`{}`**: {}",
            entry.pattern, entry.message
        )
        .expect("Writing to String cannot fail");
    }
    restrictions.push_str("\n\nDo not attempt to use these tools. Find alternative approaches.");
    restrictions
}

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

    /// Build the system prompt for a stage.
    ///
    /// The system prompt is needed for BOTH fresh spawns and resume (it's not stored).
    /// This method always calls into `PromptService` to build it fresh.
    ///
    /// The system prompt may contain Handlebars conditionals (e.g., `{{#if feedback}}`)
    /// that need the feedback context to render properly.
    fn build_system_prompt(
        &self,
        task: &Task,
        feedback: Option<&str>,
        show_direct_structured_output_hint: bool,
        activity_logs: Vec<ActivityLogEntry>,
    ) -> Result<String, ExecutionError> {
        let config = self.prompt_service.resolve_config(
            &self.workflow,
            task,
            feedback,
            None, // No integration error for system prompt
            show_direct_structured_output_hint,
            activity_logs,
        )?;
        Ok(config.system_prompt)
    }

    /// Build the user message prompt for a stage execution.
    ///
    /// If resuming, returns a short resume prompt. Otherwise returns the full
    /// user message with task context.
    #[allow(clippy::too_many_arguments)]
    fn build_user_prompt(
        &self,
        task: &Task,
        stage: &str,
        is_resume: bool,
        is_stage_reentry: bool,
        trigger: Option<&IterationTrigger>,
        show_direct_structured_output_hint: bool,
        activity_logs: Vec<ActivityLogEntry>,
    ) -> Result<String, ExecutionError> {
        if is_resume {
            let resume_type = if is_stage_reentry {
                ResumeType::Recheck
            } else {
                trigger_to_resume_type(trigger)
            };

            // Gather artifacts for this stage (respecting flow overrides)
            let input_names = self
                .workflow
                .effective_inputs(stage, task.flow.as_deref())
                .unwrap_or_default();
            let artifacts: Vec<(String, String)> = input_names
                .iter()
                .filter_map(|name| {
                    task.artifacts
                        .get(name)
                        .map(|a| (a.name.clone(), a.content.clone()))
                })
                .collect();

            build_resume_prompt(
                stage,
                &resume_type,
                &task.base_branch,
                &artifacts,
                &activity_logs,
            )
            .map_err(ExecutionError::from)
        } else {
            // Extract feedback from trigger if present (fresh spawn after session reset)
            let feedback = extract_feedback_text(trigger);

            let config = self.prompt_service.resolve_config(
                &self.workflow,
                task,
                feedback,
                None, // No integration error on first spawn
                show_direct_structured_output_hint,
                activity_logs,
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

    /// Get JSON schema for the stage, applying flow overrides if applicable.
    fn get_stage_schema(&self, task: &Task, stage: &str) -> Result<String, ExecutionError> {
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

        Ok(crate::workflow::execution::get_agent_schema(
            schema_stage,
            Some(self.prompt_service.project_root()),
        )
        .expect("Agent stage should have schema"))
    }

    /// Apply provider-specific fallbacks for system prompt and schema enforcement.
    ///
    /// Returns `(final_user_prompt, optional_system_prompt_for_config)`.
    pub(crate) fn apply_provider_fallbacks(
        task_id: &str,
        stage: &str,
        mut user_prompt: String,
        system_prompt: String,
        json_schema: &str,
        capabilities: &super::super::execution::ProviderCapabilities,
    ) -> (String, Option<String>) {
        // System prompt fallback (prepend to user message if provider doesn't support CLI flag)
        let system_prompt_for_config = if capabilities.supports_system_prompt {
            Some(system_prompt)
        } else {
            orkestra_debug!(
                "exec",
                "execute_stage {}/{}: provider lacks system prompt support, prepending to user message",
                task_id,
                stage
            );
            user_prompt = format!("{system_prompt}\n\n{user_prompt}");
            None
        };

        // Schema enforcement fallback (append to user message if provider doesn't support native JSON schema)
        if !capabilities.supports_json_schema {
            orkestra_debug!(
                "exec",
                "execute_stage {}/{}: provider lacks native schema support, embedding in prompt",
                task_id,
                stage
            );
            user_prompt = append_schema_enforcement(&user_prompt, json_schema);
        }

        (user_prompt, system_prompt_for_config)
    }

    /// Build `RunConfig` with session info, model spec, and system prompt.
    fn build_run_config(
        &self,
        task: &Task,
        params: ResolvedStageParams,
        spawn_context: &SessionSpawnContext,
    ) -> RunConfig {
        let working_dir = self.get_working_dir(task);
        let mut run_config = RunConfig::new(working_dir, params.user_prompt, params.json_schema)
            .with_task_id(&task.id);

        // Only set session when we have a caller-provided session ID.
        // Providers that generate their own IDs (OpenCode) start without one.
        if let Some(ref sid) = spawn_context.session_id {
            run_config = run_config.with_session(sid.clone(), spawn_context.is_resume);
        }

        // Thread model spec from stage config (respects flow overrides)
        if let Some(model) = params.model_spec {
            run_config = run_config.with_model(model);
        }

        // Thread system prompt if provider supports it
        if let Some(sp) = params.system_prompt {
            run_config = run_config.with_system_prompt(sp);
        }

        if !params.disallowed_tools.is_empty() {
            run_config = run_config.with_disallowed_tools(params.disallowed_tools);
        }

        run_config
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
    /// * `activity_logs` - Activity logs from prior completed iterations
    pub fn execute_stage(
        &self,
        task: &Task,
        trigger: Option<&IterationTrigger>,
        spawn_context: &SessionSpawnContext,
        activity_logs: Vec<ActivityLogEntry>,
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
        let json_schema = self.get_stage_schema(task, stage)?;

        // 2. Resolve the provider to check capabilities
        let model_spec = self.workflow.effective_model(stage, task.flow.as_deref());
        let resolved = self.registry.resolve(model_spec.as_deref())?;

        // 3. Extract feedback from trigger (used by both system prompt and user message)
        let feedback = extract_feedback_text(trigger);

        // 4. Build system prompt (needed for BOTH fresh and resume)
        // System prompt may contain Handlebars conditionals that need feedback context
        let system_prompt = self.build_system_prompt(
            task,
            feedback,
            resolved.capabilities.requires_direct_structured_output,
            activity_logs.clone(),
        )?;

        // 5. Resolve disallowed tools and inject restriction messages into system prompt
        let effective_tools = self
            .workflow
            .effective_disallowed_tools(stage, task.flow.as_deref());
        let disallowed_patterns: Vec<String> =
            effective_tools.iter().map(|e| e.pattern.clone()).collect();

        let system_prompt = if effective_tools.is_empty() {
            system_prompt
        } else {
            format!(
                "{system_prompt}{}",
                format_tool_restrictions(&effective_tools)
            )
        };

        // 6. Build user message prompt based on whether this is a resume
        let user_prompt = self.build_user_prompt(
            task,
            stage,
            spawn_context.is_resume,
            spawn_context.is_stage_reentry,
            trigger,
            resolved.capabilities.requires_direct_structured_output,
            activity_logs,
        )?;

        // 7. Apply provider fallbacks for system prompt and schema enforcement
        let (user_prompt, system_prompt_for_config) = Self::apply_provider_fallbacks(
            &task.id,
            stage,
            user_prompt,
            system_prompt,
            &json_schema,
            &resolved.capabilities,
        );

        orkestra_debug!(
            "exec",
            "execute_stage {}/{}: user_prompt len={}, system_prompt={}, is_resume={}",
            task.id,
            stage,
            user_prompt.len(),
            system_prompt_for_config.is_some(),
            spawn_context.is_resume
        );

        // 8. Build run config with session info, model spec, and system prompt
        let params = ResolvedStageParams {
            user_prompt,
            json_schema,
            system_prompt: system_prompt_for_config,
            model_spec,
            disallowed_tools: disallowed_patterns,
        };
        let run_config = self.build_run_config(task, params, spawn_context);

        // 9. Run the agent
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
        Some(IterationTrigger::RetryFailed { instructions }) => ResumeType::RetryFailed {
            instructions: instructions.clone(),
        },
        Some(IterationTrigger::RetryBlocked { instructions }) => ResumeType::RetryBlocked {
            instructions: instructions.clone(),
        },
        Some(IterationTrigger::ManualResume { message }) => ResumeType::ManualResume {
            message: message.clone(),
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

    #[test]
    fn test_system_prompt_fallback_logic() {
        use crate::workflow::execution::ProviderCapabilities;

        let task_id = "test-task";
        let stage = "work";
        let user_prompt = "Do the work".to_string();
        let system_prompt =
            "You are a worker agent.\n\n## Output Format\nProduce JSON.".to_string();
        let json_schema = r#"{"type":"object"}"#;

        // Case 1: Provider supports system prompts (Claude Code)
        let claude_caps = ProviderCapabilities {
            supports_json_schema: true,
            supports_sessions: true,
            generates_own_session_id: false,
            requires_direct_structured_output: true,
            supports_system_prompt: true,
        };

        let (final_user, sys_for_config) = AgentExecutionService::apply_provider_fallbacks(
            task_id,
            stage,
            user_prompt.clone(),
            system_prompt.clone(),
            json_schema,
            &claude_caps,
        );

        // User message should remain unchanged
        assert_eq!(final_user, "Do the work");
        // System prompt should be in config
        assert_eq!(sys_for_config, Some(system_prompt.clone()));

        // Case 2: Provider does NOT support system prompts (OpenCode)
        let opencode_caps = ProviderCapabilities {
            supports_json_schema: false,
            supports_sessions: true,
            generates_own_session_id: true,
            requires_direct_structured_output: false,
            supports_system_prompt: false,
        };

        let (final_user, sys_for_config) = AgentExecutionService::apply_provider_fallbacks(
            task_id,
            stage,
            user_prompt.clone(),
            system_prompt.clone(),
            json_schema,
            &opencode_caps,
        );

        // System prompt should be prepended to user message with "\n\n" separator
        assert!(final_user.starts_with("You are a worker agent"));
        assert!(final_user.contains("\n\nDo the work"));
        // System prompt should NOT be in config
        assert!(sys_for_config.is_none());

        // Verify the exact separator used
        assert!(
            final_user.contains(&format!("{system_prompt}\n\n{user_prompt}")),
            "Expected system prompt and user message joined with '\\n\\n' separator"
        );
    }
}
