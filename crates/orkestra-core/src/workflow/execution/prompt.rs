//! Prompt building — I/O layer.
//!
//! Pure prompt logic lives in `orkestra-prompt`. This module provides the
//! filesystem I/O needed to load agent definitions and schemas, and wraps
//! the pure logic for backward compatibility.

use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use crate::workflow::config::{StageConfig, WorkflowConfig};
use crate::workflow::domain::Task;

// Re-export everything from orkestra-prompt for backward compatibility.
pub use orkestra_prompt::{
    sibling_status_display, AgentConfigError, ArtifactContext, FlowOverrides,
    IntegrationErrorContext, PrCheckContext, PrComment, PromptBuilder,
    PromptService as PromptRenderer, QuestionAnswerContext, ResolvedAgentConfig,
    ResumeQuestionAnswer, ResumeType, SiblingTaskContext, StagePromptContext,
};
/// Lazy-initialized prompt renderer (owns pre-compiled Handlebars templates).
static RENDERER: LazyLock<PromptRenderer> = LazyLock::new(PromptRenderer::new);

// ============================================================================
// I/O Functions (stay in orkestra-core)
// ============================================================================

/// Load an agent definition from the agents directory.
///
/// Search order:
/// 1. `.orkestra/agents/{path}` in the project
/// 2. `~/.orkestra/agents/{path}` for global/default agents
pub fn load_agent_definition(project_root: Option<&Path>, path: &str) -> std::io::Result<String> {
    // Try project .orkestra/agents/ first
    if let Some(root) = project_root {
        let local_path = root.join(".orkestra/agents").join(path);
        if local_path.exists() {
            return fs::read_to_string(local_path);
        }
    }

    // Fall back to home directory for global/default agents
    if let Some(home) = dirs::home_dir() {
        let home_path = home.join(".orkestra/agents").join(path);
        if home_path.exists() {
            return fs::read_to_string(home_path);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!(
            "Agent definition not found: {path} (searched .orkestra/agents/ and ~/.orkestra/agents/)"
        ),
    ))
}

/// Load a custom JSON schema from the schemas directory.
pub fn load_custom_schema(project_root: Option<&Path>, path: &str) -> std::io::Result<String> {
    // Try project .orkestra/schemas/ first
    if let Some(root) = project_root {
        let local_path = root.join(".orkestra/schemas").join(path);
        if local_path.exists() {
            return fs::read_to_string(local_path);
        }
    }

    // Fall back to home directory
    if let Some(home) = dirs::home_dir() {
        let home_path = home.join(".orkestra/schemas").join(path);
        if home_path.exists() {
            return fs::read_to_string(home_path);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("Custom schema not found: {path}"),
    ))
}

/// Get the JSON schema for a stage's agent.
///
/// Generates schema dynamically based on stage configuration,
/// or loads custom schema if specified.
pub fn get_agent_schema(stage_config: &StageConfig, project_root: Option<&Path>) -> Option<String> {
    // Check for custom schema file first
    if let Some(schema_file) = &stage_config.schema_file {
        if let Ok(custom_schema) = load_custom_schema(project_root, schema_file) {
            return Some(custom_schema);
        }
        // Fall through to dynamic generation if custom file not found
        crate::orkestra_debug!(
            "prompt",
            "Custom schema file '{schema_file}' not found, using generated schema"
        );
    }

    // Generate schema dynamically based on stage config
    let schema_config = crate::prompts::SchemaConfig {
        artifact_name: stage_config.artifact_name(),
        ask_questions: stage_config.capabilities.ask_questions,
        produces_subtasks: stage_config.capabilities.produces_subtasks(),
        has_approval: stage_config.capabilities.has_approval(),
    };
    Some(crate::prompts::generate_stage_schema(&schema_config))
}

// ============================================================================
// Agent Configuration Resolution (I/O wrappers)
// ============================================================================

/// Resolve agent configuration for a specific stage with optional overrides.
///
/// Loads the agent definition and JSON schema from disk, then delegates
/// to orkestra-prompt for pure assembly.
///
/// # Arguments
/// * `artifact_names` - Names of artifacts that have been materialized to the worktree.
///   These are used to construct file paths in the prompt.
#[allow(clippy::too_many_arguments)]
pub fn resolve_stage_agent_config_for(
    workflow: &WorkflowConfig,
    task: &Task,
    stage_name: &str,
    artifact_names: &[String],
    project_root: Option<&Path>,
    feedback: Option<&str>,
    integration_error: Option<IntegrationErrorContext<'_>>,
    flow_overrides: &FlowOverrides<'_>,
    show_direct_structured_output_hint: bool,
    sibling_tasks: &[SiblingTaskContext],
) -> Result<ResolvedAgentConfig, AgentConfigError> {
    let stage = workflow
        .stage(stage_name)
        .ok_or_else(|| AgentConfigError::UnknownStage(stage_name.to_string()))?;

    // Resolve effective stage for schema generation (apply flow overrides)
    // Only capabilities need overriding — artifact handling is now done at materialization time.
    let effective_stage = if flow_overrides.capabilities.is_some() {
        let mut s = stage.clone();
        if let Some(caps) = flow_overrides.capabilities {
            s.capabilities = caps.clone();
        }
        s
    } else {
        stage.clone()
    };

    // I/O: Load agent definition from disk
    let definition_path = flow_overrides
        .prompt
        .map(String::from)
        .or_else(|| stage.prompt_path())
        .unwrap_or_else(|| format!("{stage_name}.md"));

    let agent_def = load_agent_definition(project_root, &definition_path)
        .map_err(|e| AgentConfigError::DefinitionNotFound(e.to_string()))?;

    // I/O: Get JSON schema (may load custom schema from disk)
    let json_schema = get_agent_schema(&effective_stage, project_root).ok_or_else(|| {
        AgentConfigError::PromptBuildError(format!("No schema for agent stage '{stage_name}'"))
    })?;

    // Pure: delegate to orkestra-prompt for assembly
    RENDERER.build_agent_config(
        workflow,
        task,
        stage_name,
        artifact_names,
        &agent_def,
        &json_schema,
        feedback,
        integration_error,
        flow_overrides,
        show_direct_structured_output_hint,
        sibling_tasks,
    )
}

/// Build a user message from task context.
pub fn build_user_message(ctx: &StagePromptContext<'_>) -> String {
    RENDERER.build_user_message(ctx)
}

/// Build a resume prompt for session continuation.
pub fn build_resume_prompt(
    stage: &str,
    resume_type: &ResumeType,
    base_branch: &str,
    artifact_names: &[String],
    worktree_path: Option<&str>,
) -> Result<String, AgentConfigError> {
    RENDERER.build_resume_prompt(
        stage,
        resume_type,
        base_branch,
        artifact_names,
        worktree_path,
    )
}

/// Determine the resume type from context.
pub fn determine_resume_type(
    feedback: Option<&str>,
    integration_error: Option<&IntegrationErrorContext<'_>>,
    question_history: &[crate::workflow::domain::QuestionAnswer],
) -> ResumeType {
    RENDERER.determine_resume_type(feedback, integration_error, question_history)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{
        FlowConfig, FlowStageEntry, StageCapabilities, StageConfig, WorkflowConfig,
    };
    use crate::workflow::stage::types::{deduplicate_activity_logs_by_stage, ActivityLogEntry};
    use indexmap::IndexMap;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_display_name("Planning")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_display_name("Working"),
            StageConfig::new("review", "verdict")
                .with_display_name("Reviewing")
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
    }

    // -- PromptBuilder tests (validate the orkestra-prompt integration) --

    #[test]
    fn test_build_context_planning() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "planning",
            "now",
        );

        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &[])
            .unwrap();

        assert_eq!(ctx.stage.name, "planning");
        assert_eq!(ctx.task_id, "task-1");
        assert_eq!(ctx.task_file_path, ".orkestra/.artifacts/task.md");
        assert!(ctx.artifacts.is_empty());
        assert!(ctx.feedback.is_none());
    }

    #[test]
    fn test_build_context_review_stage() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "review",
            "now",
        );

        // Pass artifact names (artifacts are materialized to files before spawn)
        let artifact_names = vec!["plan".to_string(), "summary".to_string()];
        let ctx = builder
            .build_context("review", &task, &artifact_names, None, None, false, &[])
            .unwrap();

        assert_eq!(ctx.stage.name, "review");
        assert_eq!(ctx.artifacts.len(), 2);
        assert!(ctx.stage.capabilities.has_approval());
        assert_eq!(ctx.stage.capabilities.rejection_stage(), Some("work"));
    }

    #[test]
    fn test_build_context_missing_stage() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Desc", "planning", "now");

        let ctx = builder.build_context("nonexistent", &task, &[], None, None, false, &[]);
        assert!(ctx.is_none());
    }

    #[test]
    fn test_build_context_with_artifacts() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "work",
            "now",
        );

        // Pass artifact names (artifacts are materialized to files before agent spawn)
        let artifact_names = vec!["plan".to_string()];
        let ctx = builder
            .build_context("work", &task, &artifact_names, None, None, false, &[])
            .unwrap();

        // Verify context has artifact with file path (not inline content)
        assert_eq!(ctx.artifacts.len(), 1);
        assert_eq!(ctx.artifacts[0].name, "plan");
        assert_eq!(ctx.artifacts[0].file_path, ".orkestra/.artifacts/plan.md");
    }

    #[test]
    fn test_build_context_with_artifacts_absolute_path() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "work",
            "now",
        );
        task.worktree_path = Some("/path/to/worktree".to_string());

        let artifact_names = vec!["plan".to_string()];
        let ctx = builder
            .build_context("work", &task, &artifact_names, None, None, false, &[])
            .unwrap();

        // With worktree_path set, should use absolute paths
        assert_eq!(ctx.artifacts.len(), 1);
        assert_eq!(ctx.artifacts[0].name, "plan");
        assert_eq!(
            ctx.artifacts[0].file_path,
            "/path/to/worktree/.orkestra/.artifacts/plan.md"
        );
    }

    #[test]
    fn test_build_context_with_capabilities() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &[])
            .unwrap();

        assert!(ctx.stage.capabilities.ask_questions);
    }

    #[test]
    fn test_build_context_with_approval() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "review", "now");

        // Pass artifact names for review stage inputs
        let artifact_names = vec!["plan".to_string(), "summary".to_string()];
        let ctx = builder
            .build_context("review", &task, &artifact_names, None, None, false, &[])
            .unwrap();

        assert!(ctx.stage.capabilities.has_approval());
        // Verify artifacts use file paths
        assert_eq!(ctx.artifacts.len(), 2);
        assert_eq!(ctx.artifacts[0].file_path, ".orkestra/.artifacts/plan.md");
        assert_eq!(
            ctx.artifacts[1].file_path,
            ".orkestra/.artifacts/summary.md"
        );
    }

    #[test]
    fn test_build_context_with_feedback() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let ctx = builder
            .build_context(
                "planning",
                &task,
                &[],
                Some("Please add more detail"),
                None,
                false,
                &[],
            )
            .unwrap();

        assert_eq!(ctx.feedback, Some("Please add more detail"));
    }

    #[test]
    fn test_context_question_history_is_empty() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &[])
            .unwrap();

        assert!(ctx.question_history.is_empty());
    }

    // -- Schema generation tests (I/O) --

    #[test]
    fn test_get_agent_schema_generates_dynamically() {
        let planning = StageConfig::new("planning", "plan")
            .with_capabilities(StageCapabilities::with_questions());
        let schema = get_agent_schema(&planning, None).unwrap();
        assert!(schema.contains("\"plan\""));
        assert!(schema.contains("\"questions\""));

        let work = StageConfig::new("work", "summary");
        let schema = get_agent_schema(&work, None).unwrap();
        assert!(schema.contains("\"summary\""));
        assert!(!schema.contains("\"questions\""));

        let review = StageConfig::new("review", "verdict")
            .with_capabilities(StageCapabilities::with_approval(Some("work".into())));
        let schema = get_agent_schema(&review, None).unwrap();
        assert!(schema.contains("\"approval\""));
        assert!(!schema.contains("\"verdict\""));
    }

    #[test]
    fn test_agent_config_error_display() {
        let err = AgentConfigError::NotInActiveStage;
        assert_eq!(err.to_string(), "Task is not in an active stage");

        let err = AgentConfigError::UnknownStage("foo".into());
        assert_eq!(err.to_string(), "Unknown stage: foo");

        let err = AgentConfigError::DefinitionNotFound("missing.md".into());
        assert!(err.to_string().contains("missing.md"));
    }

    // -- Resume prompt tests --

    #[test]
    fn test_build_resume_prompt_continue() {
        let artifact_names = vec!["plan".to_string()];
        let prompt =
            build_resume_prompt("work", &ResumeType::Continue, "main", &artifact_names, None)
                .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(prompt.contains("interrupted"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_feedback() {
        let artifact_names = vec!["summary".to_string()];
        let prompt = build_resume_prompt(
            "review",
            &ResumeType::Feedback {
                feedback: "Add more error handling".to_string(),
            },
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:feedback>"));
        assert!(prompt.contains("Add more error handling"));
        assert!(prompt.contains("revision"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_integration() {
        let artifact_names = vec!["breakdown".to_string()];
        let prompt = build_resume_prompt(
            "work",
            &ResumeType::Integration {
                message: "Merge conflict detected".to_string(),
                conflict_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            },
            "feature/parent-branch",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:integration>"));
        assert!(prompt.contains("Merge conflict detected"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("merge is in progress"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_answers() {
        let artifact_names = vec!["requirements".to_string()];
        let prompt = build_resume_prompt(
            "planning",
            &ResumeType::Answers {
                answers: vec![
                    ResumeQuestionAnswer {
                        question: "Which database?".to_string(),
                        answer: "PostgreSQL".to_string(),
                    },
                    ResumeQuestionAnswer {
                        question: "Add caching?".to_string(),
                        answer: "Yes, use Redis".to_string(),
                    },
                ],
            },
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:planning:answers>"));
        assert!(prompt.contains("Which database?"));
        assert!(prompt.contains("PostgreSQL"));
        assert!(prompt.contains("Add caching?"));
        assert!(prompt.contains("Yes, use Redis"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_no_artifacts() {
        let prompt = build_resume_prompt("work", &ResumeType::Continue, "main", &[], None).unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(prompt.contains("interrupted"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_manual_resume_with_message() {
        let artifact_names = vec!["plan".to_string()];
        let prompt = build_resume_prompt(
            "work",
            &ResumeType::ManualResume {
                message: Some("Fix the validation logic".to_string()),
            },
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:manual_resume>"));
        assert!(prompt.contains("interrupted by the user"));
        assert!(prompt.contains("Message from the user"));
        assert!(prompt.contains("Fix the validation logic"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_manual_resume_no_message() {
        let prompt = build_resume_prompt(
            "review",
            &ResumeType::ManualResume { message: None },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:manual_resume>"));
        assert!(prompt.contains("interrupted by the user"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Message from the user"));
    }

    #[test]
    fn test_build_resume_prompt_pr_comments() {
        let comments = vec![
            PrComment {
                author: "reviewer1".to_string(),
                path: "src/main.rs".to_string(),
                line: Some(42),
                body: "This function needs error handling".to_string(),
            },
            PrComment {
                author: "reviewer2".to_string(),
                path: "src/lib.rs".to_string(),
                line: None,
                body: "Consider adding tests for this module".to_string(),
            },
        ];
        let prompt = build_resume_prompt(
            "work",
            &ResumeType::PrComments {
                comments,
                checks: vec![],
                guidance: Some("Focus on the error handling first".to_string()),
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:pr_comments>"));
        assert!(prompt.contains("reviewer1"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("line 42"));
        assert!(prompt.contains("This function needs error handling"));
        assert!(prompt.contains("reviewer2"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("Consider adding tests"));
        assert!(prompt.contains("Focus on the error handling first"));
    }

    #[test]
    fn test_build_resume_prompt_pr_comments_no_guidance() {
        let comments = vec![PrComment {
            author: "reviewer".to_string(),
            path: "README.md".to_string(),
            line: None,
            body: "Typo in documentation".to_string(),
        }];
        let prompt = build_resume_prompt(
            "work",
            &ResumeType::PrComments {
                comments,
                checks: vec![],
                guidance: None,
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:pr_comments>"));
        assert!(prompt.contains("reviewer"));
        assert!(prompt.contains("README.md"));
        assert!(prompt.contains("Typo in documentation"));
        assert!(!prompt.contains("User guidance"));
    }

    // -- Determine resume type tests --

    #[test]
    fn test_determine_resume_type_integration_takes_priority() {
        use crate::workflow::domain::QuestionAnswer;
        let error = IntegrationErrorContext {
            message: "conflict",
            conflict_files: vec!["file.rs"],
            base_branch: "main",
        };
        let answers = vec![QuestionAnswer::new("What?", "Something", "now")];
        let result = determine_resume_type(Some("feedback"), Some(&error), &answers);
        assert!(matches!(result, ResumeType::Integration { .. }));
    }

    #[test]
    fn test_determine_resume_type_feedback_over_answers() {
        use crate::workflow::domain::QuestionAnswer;
        let answers = vec![QuestionAnswer::new("What?", "Something", "now")];
        let result = determine_resume_type(Some("please fix"), None, &answers);
        match result {
            ResumeType::Feedback { feedback } => assert_eq!(feedback, "please fix"),
            _ => panic!("Expected Feedback variant"),
        }
    }

    #[test]
    fn test_determine_resume_type_answers() {
        use crate::workflow::domain::QuestionAnswer;
        let answers = vec![
            QuestionAnswer::new("Which DB?", "PostgreSQL", "now"),
            QuestionAnswer::new("Add cache?", "Yes", "now"),
        ];
        let result = determine_resume_type(None, None, &answers);
        match result {
            ResumeType::Answers { answers } => {
                assert_eq!(answers.len(), 2);
                assert_eq!(answers[0].question, "Which DB?");
                assert_eq!(answers[0].answer, "PostgreSQL");
            }
            _ => panic!("Expected Answers variant"),
        }
    }

    #[test]
    fn test_determine_resume_type_continue() {
        let result = determine_resume_type(None, None, &[]);
        assert!(matches!(result, ResumeType::Continue));
    }

    #[test]
    fn test_resolved_agent_config_has_system_prompt() {
        use tempfile::TempDir;

        let workflow = test_workflow();
        let temp_dir = TempDir::new().unwrap();

        let agents_dir = temp_dir.path().join(".orkestra/agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(
            agents_dir.join("planning.md"),
            "You are a planning agent. Create implementation plans.",
        )
        .unwrap();

        let mut task = Task::new("task-1", "Test", "Description", "planning", "now");
        task.worktree_path = Some(temp_dir.path().to_string_lossy().to_string());

        let config = resolve_stage_agent_config_for(
            &workflow,
            &task,
            "planning",
            &[], // No artifacts for planning stage
            Some(temp_dir.path()),
            None,
            None,
            &FlowOverrides::default(),
            false,
            &[],
        )
        .unwrap();

        assert!(
            !config.system_prompt.is_empty(),
            "system_prompt should not be empty"
        );
        assert!(
            config.system_prompt.contains("planning agent"),
            "system_prompt should contain agent definition"
        );
        assert!(
            config.system_prompt.contains("Output Format")
                || config.system_prompt.contains("output format"),
            "system_prompt should contain output format instructions"
        );
        assert!(
            config.system_prompt.contains("plan"),
            "system_prompt should reference the artifact name 'plan'"
        );
    }

    #[test]
    fn test_system_prompt_not_in_user_message() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "work",
            "now",
        );

        let artifact_names = vec!["plan".to_string()];
        let ctx = builder
            .build_context("work", &task, &artifact_names, None, None, false, &[])
            .unwrap();

        let user_message = build_user_message(&ctx);

        assert!(!user_message.contains("Output Format"));
        assert!(!user_message.contains("worker agent"));
        assert!(user_message.contains("Trak ID"));
        assert!(user_message.contains("task-1"));
        assert!(user_message.contains(".orkestra/.artifacts/task.md"));
    }

    #[test]
    fn test_build_user_message_contains_task_context() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new(
            "task-1",
            "Implement feature",
            "Add new feature",
            "work",
            "now",
        );

        let artifact_names = vec!["plan".to_string()];
        let ctx = builder
            .build_context("work", &task, &artifact_names, None, None, false, &[])
            .unwrap();

        let user_message = build_user_message(&ctx);

        assert!(user_message.contains("task-1"));
        // Title and description are virtualized — only the task file path is referenced
        assert!(!user_message.contains("Implement feature"));
        assert!(!user_message.contains("Add new feature"));
        assert!(user_message.contains(".orkestra/.artifacts/task.md"));
        // Stage artifacts show file paths
        assert!(user_message.contains(".orkestra/.artifacts/plan.md"));
        assert!(user_message.contains("Input Artifacts"));
    }

    #[test]
    fn test_resume_prompt_has_no_system_prompt() {
        let prompt = build_resume_prompt("work", &ResumeType::Continue, "main", &[], None).unwrap();

        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(!prompt.contains("Output Format"));
        assert!(!prompt.contains("agent definition"));
    }

    // -- Workflow overview tests --

    #[test]
    fn test_workflow_overview_in_prompt() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict").with_description("Review the work"),
        ]);
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "work", "now");
        let ctx = builder
            .build_context("work", &task, &[], None, None, false, &[])
            .unwrap();

        let user_message = build_user_message(&ctx);

        assert!(user_message.contains("## Your Workflow"));
        assert!(user_message.contains("[plan] — Create a plan"));
        assert!(user_message.contains("[work] ← YOU ARE HERE — Implement the plan"));
        assert!(user_message.contains("[review] — Review the work"));
    }

    #[test]
    fn test_workflow_overview_with_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".into(),
            FlowConfig {
                description: "Quick flow".into(),
                icon: Some("zap".into()),
                stages: vec![
                    FlowStageEntry {
                        stage_name: "plan".into(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "work".into(),
                        overrides: None,
                    },
                ],
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("task", "breakdown"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ])
        .with_flows(flows);
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new("task-1", "Test", "Description", "work", "now");
        task.flow = Some("quick".into());

        let ctx = builder
            .build_context("work", &task, &[], None, None, false, &[])
            .unwrap();

        let user_message = build_user_message(&ctx);

        assert!(user_message.contains("## Your Workflow"));
        assert!(user_message.contains("[plan] — Create a plan"));
        assert!(user_message.contains("[work] ← YOU ARE HERE — Implement the plan"));
        assert!(!user_message.contains("[task]"));
        assert!(!user_message.contains("[review]"));
    }

    // -- Sibling context tests --

    #[test]
    fn test_build_user_message_with_siblings() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let siblings = vec![
            SiblingTaskContext {
                short_id: "bird".into(),
                title: "First subtask".into(),
                description: "Do the first thing".into(),
                dependency_relationship: None,
                status_display: "pending".into(),
            },
            SiblingTaskContext {
                short_id: "cat".into(),
                title: "Second subtask".into(),
                description: "Depends on first".into(),
                dependency_relationship: Some("this task depends on".into()),
                status_display: "done".into(),
            },
        ];

        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &siblings)
            .unwrap();

        let user_message = build_user_message(&ctx);

        assert!(user_message.contains("## Sibling Subtraks"));
        assert!(user_message.contains("This Trak is part of a breakdown"));
        assert!(user_message.contains("**bird** First subtask"));
        assert!(user_message.contains("(pending)"));
        assert!(user_message.contains("Do the first thing"));
        assert!(user_message.contains("**cat** Second subtask"));
        assert!(user_message.contains("[this task depends on]"));
        assert!(user_message.contains("(done)"));
    }

    #[test]
    fn test_build_user_message_without_siblings() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &[])
            .unwrap();

        let user_message = build_user_message(&ctx);

        assert!(!user_message.contains("## Sibling Subtraks"));
        assert!(!user_message.contains("This Trak is part of a breakdown"));
    }

    // -- Activity log dedup tests --

    #[test]
    fn test_deduplicate_activity_logs_empty_input() {
        let logs: Vec<ActivityLogEntry> = vec![];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert!(result.is_empty());
    }

    #[test]
    fn test_deduplicate_activity_logs_single_stage() {
        let logs = vec![
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 1,
                content: "Log A".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 2,
                content: "Log B".into(),
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "Log B");
    }

    #[test]
    fn test_deduplicate_activity_logs_interleaved() {
        let logs = vec![
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 1,
                content: "A".into(),
            },
            ActivityLogEntry {
                stage: "review".into(),
                iteration_number: 2,
                content: "C".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 3,
                content: "B".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 4,
                content: "D".into(),
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].content, "A");
        assert_eq!(result[1].content, "C");
        assert_eq!(result[2].content, "D");
    }
}
