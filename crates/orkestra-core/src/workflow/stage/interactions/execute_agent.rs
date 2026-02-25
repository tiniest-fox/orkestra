//! Execute an agent for a workflow stage.
//!
//! This is the core execution pipeline: resolve provider → build prompts →
//! apply schema enforcement → apply tool restrictions → run agent.

use std::path::PathBuf;
use std::sync::LazyLock;

use crate::orkestra_debug;
use crate::workflow::config::{ToolRestriction, WorkflowConfig};
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::execution::{
    build_resume_prompt, AgentRunnerTrait, PrComment, ProviderCapabilities, ProviderRegistry,
    ResumeQuestionAnswer, ResumeType, RunConfig, SiblingTaskContext,
};
use crate::workflow::prompt::PromptService;
use crate::workflow::stage::agents::{ExecutionError, ExecutionHandle};
use crate::workflow::stage::session::SessionSpawnContext;
use crate::workflow::stage::types::ActivityLogEntry;

// ============================================================================
// Entry Point
// ============================================================================

/// Execute a stage for a task.
///
/// Resolves the provider, builds prompts, applies schema enforcement and tool
/// restrictions, then runs the agent. Returns a handle for polling completion.
#[allow(clippy::too_many_arguments)]
pub(crate) fn execute(
    runner: &dyn AgentRunnerTrait,
    prompt_service: &PromptService,
    workflow: &WorkflowConfig,
    registry: &ProviderRegistry,
    task: &Task,
    trigger: Option<&IterationTrigger>,
    spawn_context: &SessionSpawnContext,
    activity_logs: &[ActivityLogEntry],
    sibling_tasks: &[SiblingTaskContext],
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

    // 0. Materialize artifacts to worktree files before building prompts
    let artifact_names =
        super::materialize_artifacts::execute(task, activity_logs).map_err(|e| {
            ExecutionError::ConfigError(format!("Failed to materialize artifacts: {e}"))
        })?;

    orkestra_debug!(
        "exec",
        "execute_stage {}/{}: materialized {} artifacts",
        task.id,
        stage,
        artifact_names.len()
    );

    // 1. Get JSON schema (needed for BOTH first spawn and resume)
    let json_schema = get_stage_schema(workflow, prompt_service, task, stage)?;

    // 2. Resolve the provider to check capabilities
    let model_spec = workflow.effective_model(stage, task.flow.as_deref());
    let resolved = registry.resolve(model_spec.as_deref())?;

    // 3. Extract feedback from trigger (used by both system prompt and user message)
    let feedback = extract_feedback_text(trigger);

    // 4. Build system prompt (needed for BOTH fresh and resume)
    // System prompt may contain Handlebars conditionals that need feedback context
    let system_prompt = build_system_prompt(
        prompt_service,
        workflow,
        task,
        &artifact_names,
        feedback,
        resolved.capabilities.requires_direct_structured_output,
        sibling_tasks,
    )?;

    // 5. Apply tool restrictions (split into prompt text + CLI patterns)
    let effective_tools = workflow.effective_disallowed_tools(stage, task.flow.as_deref());
    let (system_prompt, disallowed_patterns) =
        apply_tool_restrictions(system_prompt, &effective_tools)?;

    // 6. Build user message prompt based on whether this is a resume
    let user_prompt = build_user_prompt(
        prompt_service,
        workflow,
        task,
        &artifact_names,
        stage,
        spawn_context.is_resume,
        spawn_context.is_stage_reentry,
        trigger,
        resolved.capabilities.requires_direct_structured_output,
        sibling_tasks,
    )?;

    // 7. Apply provider fallbacks for system prompt and schema enforcement
    let (user_prompt, system_prompt_for_config) = apply_provider_fallbacks(
        &task.id,
        stage,
        user_prompt,
        system_prompt,
        &json_schema,
        &resolved.capabilities,
    )?;

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
    let stage_config = ResolvedStageConfig {
        user_prompt,
        json_schema,
        system_prompt: system_prompt_for_config,
        model_spec,
        disallowed_tool_patterns: disallowed_patterns,
    };
    let run_config = build_run_config(prompt_service, task, stage_config, spawn_context);

    // 9. Run the agent
    let (pid, events) = runner.run_async(run_config)?;

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

// ============================================================================
// Helpers
// ============================================================================

// -- Types --

/// Resolved stage configuration for building `RunConfig`.
struct ResolvedStageConfig {
    user_prompt: String,
    json_schema: String,
    system_prompt: Option<String>,
    model_spec: Option<String>,
    disallowed_tool_patterns: Vec<String>,
}

// -- Prompt Building --

/// Build the system prompt for a stage.
#[allow(clippy::too_many_arguments)]
fn build_system_prompt(
    prompt_service: &PromptService,
    workflow: &WorkflowConfig,
    task: &Task,
    artifact_names: &[String],
    feedback: Option<&str>,
    show_direct_structured_output_hint: bool,
    sibling_tasks: &[SiblingTaskContext],
) -> Result<String, ExecutionError> {
    let config = prompt_service.resolve_config(
        workflow,
        task,
        artifact_names,
        feedback,
        None, // No integration error for system prompt
        show_direct_structured_output_hint,
        sibling_tasks,
    )?;
    Ok(config.system_prompt)
}

/// Build the user message prompt for a stage execution.
///
/// If resuming, returns a short resume prompt. Otherwise returns the full
/// user message with task context.
#[allow(clippy::too_many_arguments)]
fn build_user_prompt(
    prompt_service: &PromptService,
    workflow: &WorkflowConfig,
    task: &Task,
    artifact_names: &[String],
    stage: &str,
    is_resume: bool,
    is_stage_reentry: bool,
    trigger: Option<&IterationTrigger>,
    show_direct_structured_output_hint: bool,
    sibling_tasks: &[SiblingTaskContext],
) -> Result<String, ExecutionError> {
    if is_resume {
        let resume_type = if is_stage_reentry {
            ResumeType::Recheck
        } else {
            trigger_to_resume_type(trigger)
        };

        build_resume_prompt(
            stage,
            &resume_type,
            &task.base_branch,
            artifact_names,
            task.worktree_path.as_deref(),
        )
        .map_err(ExecutionError::from)
    } else {
        // Extract feedback from trigger if present (fresh spawn after session reset)
        let feedback = extract_feedback_text(trigger);

        let config = prompt_service.resolve_config(
            workflow,
            task,
            artifact_names,
            feedback,
            None, // No integration error on first spawn
            show_direct_structured_output_hint,
            sibling_tasks,
        )?;
        Ok(config.prompt)
    }
}

/// Extract feedback text from an iteration trigger.
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

/// Convert `IterationTrigger` to `ResumeType` for prompt building.
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
        Some(IterationTrigger::PrComments { comments, guidance }) => ResumeType::PrComments {
            comments: comments
                .iter()
                .map(|c| PrComment {
                    author: c.author.clone(),
                    body: c.body.clone(),
                    path: c.path.clone().unwrap_or_default(),
                    line: c.line,
                })
                .collect(),
            guidance: guidance.clone(),
        },
    }
}

// -- Schema & Provider --

/// Get JSON schema for the stage, applying flow overrides if applicable.
fn get_stage_schema(
    workflow: &WorkflowConfig,
    prompt_service: &PromptService,
    task: &Task,
    stage: &str,
) -> Result<String, ExecutionError> {
    let stage_config = workflow
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
        if let Some(caps) = workflow.effective_capabilities(stage, task.flow.as_deref()) {
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

    crate::workflow::execution::get_agent_schema(schema_stage, Some(prompt_service.project_root()))
        .ok_or_else(|| ExecutionError::ConfigError(format!("No schema for agent stage: {stage}")))
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
    capabilities: &ProviderCapabilities,
) -> Result<(String, Option<String>), ExecutionError> {
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
        user_prompt = append_schema_enforcement(&user_prompt, json_schema)?;
    }

    Ok((user_prompt, system_prompt_for_config))
}

// -- Tool Restrictions --

/// Format tool restrictions as a markdown section for injection into system prompt.
fn format_tool_restrictions(tools: &[ToolRestriction]) -> Result<String, ExecutionError> {
    let data = serde_json::json!({ "entries": tools });
    AGENT_EXEC_TEMPLATES
        .render("tool_restrictions", &data)
        .map_err(|e| {
            ExecutionError::ConfigError(format!("Failed to render tool restrictions template: {e}"))
        })
}

/// Resolve disallowed tools for a stage and split into prompt text and CLI patterns.
fn apply_tool_restrictions(
    system_prompt: String,
    effective_tools: &[ToolRestriction],
) -> Result<(String, Vec<String>), ExecutionError> {
    if effective_tools.is_empty() {
        return Ok((system_prompt, Vec::new()));
    }
    let patterns = effective_tools.iter().map(|e| e.pattern.clone()).collect();
    let restrictions = format_tool_restrictions(effective_tools)?;
    let prompt_with_restrictions = format!("{system_prompt}\n\n{restrictions}");
    Ok((prompt_with_restrictions, patterns))
}

// -- Schema Enforcement --

const SCHEMA_ENFORCEMENT_TEMPLATE: &str =
    include_str!("../../../prompts/templates/schema_enforcement.md");

const TOOL_RESTRICTIONS_TEMPLATE: &str =
    include_str!("../../../prompts/templates/tool_restrictions.md");

static AGENT_EXEC_TEMPLATES: LazyLock<handlebars::Handlebars<'static>> = LazyLock::new(|| {
    let mut hb = handlebars::Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.register_template_string("tool_restrictions", TOOL_RESTRICTIONS_TEMPLATE)
        .expect("tool_restrictions template should be valid");
    hb.register_template_string("schema_enforcement", SCHEMA_ENFORCEMENT_TEMPLATE)
        .expect("schema_enforcement template should be valid");
    hb
});

/// Append a schema enforcement section to a prompt for providers that don't
/// support native `--json-schema` enforcement.
fn append_schema_enforcement(prompt: &str, json_schema: &str) -> Result<String, ExecutionError> {
    let rendered = AGENT_EXEC_TEMPLATES
        .render(
            "schema_enforcement",
            &serde_json::json!({ "json_schema": json_schema }),
        )
        .map_err(|e| {
            ExecutionError::ConfigError(format!(
                "Failed to render schema enforcement template: {e}"
            ))
        })?;
    Ok(format!("{prompt}\n\n{rendered}"))
}

// -- Run Config --

/// Get the working directory for a task.
fn get_working_dir(prompt_service: &PromptService, task: &Task) -> PathBuf {
    task.worktree_path.as_ref().map_or_else(
        || prompt_service.project_root().to_path_buf(),
        PathBuf::from,
    )
}

/// Build `RunConfig` with session info, model spec, and system prompt.
fn build_run_config(
    prompt_service: &PromptService,
    task: &Task,
    resolved: ResolvedStageConfig,
    spawn_context: &SessionSpawnContext,
) -> RunConfig {
    let working_dir = get_working_dir(prompt_service, task);
    let mut run_config = RunConfig::new(working_dir, resolved.user_prompt, resolved.json_schema)
        .with_task_id(&task.id);

    // Only set session when we have a caller-provided session ID.
    // Providers that generate their own IDs (OpenCode) start without one.
    if let Some(ref sid) = spawn_context.session_id {
        run_config = run_config.with_session(sid.clone(), spawn_context.is_resume);
    }

    // Thread model spec from stage config (respects flow overrides)
    if let Some(model) = resolved.model_spec {
        run_config = run_config.with_model(model);
    }

    // Thread system prompt if provider supports it
    if let Some(sp) = resolved.system_prompt {
        run_config = run_config.with_system_prompt(sp);
    }

    if !resolved.disallowed_tool_patterns.is_empty() {
        run_config = run_config.with_disallowed_tools(resolved.disallowed_tool_patterns);
    }

    run_config
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::ToolRestriction;
    use crate::workflow::domain::PrCommentData;
    use crate::workflow::execution::ProviderCapabilities;

    #[test]
    fn test_append_schema_enforcement() {
        let prompt = "Do the task";
        let schema = r#"{"type":"object","properties":{"result":{"type":"string"}}}"#;
        let result = append_schema_enforcement(prompt, schema).unwrap();

        assert!(result.starts_with("Do the task"));
        assert!(result.contains("## Required Output Format"));
        assert!(result.contains(schema));
        assert!(result.contains("Output ONLY the JSON object"));
    }

    #[test]
    fn test_append_schema_enforcement_preserves_original_prompt() {
        let prompt = "Line 1\nLine 2\nLine 3";
        let schema = r#"{"type":"object"}"#;
        let result = append_schema_enforcement(prompt, schema).unwrap();

        assert!(result.starts_with("Line 1\nLine 2\nLine 3\n"));
    }

    #[test]
    fn test_format_tool_restrictions_basic() {
        let tools = vec![
            ToolRestriction {
                pattern: "Bash(cargo test)".to_string(),
                message: Some("Use checks stage".to_string()),
            },
            ToolRestriction {
                pattern: "Edit".to_string(),
                message: Some("Read-only".to_string()),
            },
        ];
        let result = format_tool_restrictions(&tools).unwrap();
        assert!(result.contains("## Tool Restrictions"));
        assert!(result.contains("`Bash(cargo test)`"));
        assert!(result.contains("Use checks stage"));
        assert!(result.contains("`Edit`"));
        assert!(result.contains("Read-only"));
        assert!(result.contains("Do not attempt"));
    }

    #[test]
    fn test_format_tool_restrictions_empty_message() {
        let tools = vec![ToolRestriction {
            pattern: "Bash(cargo *)".to_string(),
            message: None,
        }];
        let result = format_tool_restrictions(&tools).unwrap();
        // Should contain the pattern but NOT a trailing colon
        assert!(result.contains("`Bash(cargo *)`"));
        assert!(
            !result.contains("`Bash(cargo *)`**:"),
            "Empty message should not produce trailing colon"
        );
    }

    #[test]
    fn test_provider_fallback_with_system_prompt_support() {
        let task_id = "test-task";
        let stage = "work";
        let user_prompt = "Do the work".to_string();
        let system_prompt =
            "You are a worker agent.\n\n## Output Format\nProduce JSON.".to_string();
        let json_schema = r#"{"type":"object"}"#;

        let claude_caps = ProviderCapabilities {
            supports_json_schema: true,
            supports_sessions: true,
            generates_own_session_id: false,
            requires_direct_structured_output: true,
            supports_system_prompt: true,
        };

        let (final_user, sys_for_config) = apply_provider_fallbacks(
            task_id,
            stage,
            user_prompt,
            system_prompt.clone(),
            json_schema,
            &claude_caps,
        )
        .unwrap();

        // User message should remain unchanged
        assert_eq!(final_user, "Do the work");
        // System prompt should be in config
        assert_eq!(sys_for_config, Some(system_prompt));
    }

    #[test]
    fn test_provider_fallback_without_system_prompt_support() {
        let task_id = "test-task";
        let stage = "work";
        let user_prompt = "Do the work".to_string();
        let system_prompt =
            "You are a worker agent.\n\n## Output Format\nProduce JSON.".to_string();
        let json_schema = r#"{"type":"object"}"#;

        let opencode_caps = ProviderCapabilities {
            supports_json_schema: false,
            supports_sessions: true,
            generates_own_session_id: true,
            requires_direct_structured_output: false,
            supports_system_prompt: false,
        };

        let (final_user, sys_for_config) = apply_provider_fallbacks(
            task_id,
            stage,
            user_prompt.clone(),
            system_prompt.clone(),
            json_schema,
            &opencode_caps,
        )
        .unwrap();

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

    #[test]
    fn test_trigger_to_resume_type_pr_comments() {
        let trigger = IterationTrigger::PrComments {
            comments: vec![
                PrCommentData {
                    author: "reviewer1".to_string(),
                    body: "Fix this bug".to_string(),
                    path: Some("src/main.rs".to_string()),
                    line: Some(42),
                },
                PrCommentData {
                    author: "reviewer2".to_string(),
                    body: "PR-level comment".to_string(),
                    path: None,
                    line: None,
                },
            ],
            guidance: Some("Focus on error handling".to_string()),
        };

        let resume = trigger_to_resume_type(Some(&trigger));

        match resume {
            ResumeType::PrComments { comments, guidance } => {
                assert_eq!(comments.len(), 2);
                assert_eq!(comments[0].author, "reviewer1");
                assert_eq!(comments[0].body, "Fix this bug");
                assert_eq!(comments[0].path, "src/main.rs");
                assert_eq!(comments[0].line, Some(42));
                assert_eq!(comments[1].author, "reviewer2");
                assert_eq!(comments[1].body, "PR-level comment");
                assert_eq!(comments[1].path, ""); // None becomes empty string
                assert_eq!(comments[1].line, None);
                assert_eq!(guidance, Some("Focus on error handling".to_string()));
            }
            _ => panic!("Expected PrComments resume type"),
        }
    }
}
