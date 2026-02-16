//! User message construction.
//!
//! Builds the user message from task context using the `initial_prompt` template.

use handlebars::Handlebars;
use serde::Serialize;

use crate::types::{
    ActivityLogEntry, ArtifactContext, IntegrationErrorContext, QuestionAnswerContext,
    SiblingTaskContext, StagePromptContext, WorkflowStageEntry,
};

// ============================================================================
// Interaction
// ============================================================================

/// Build a user message from task context.
///
/// Renders the `initial_prompt.md` template with only task context
/// (no agent definition or output format — those go in the system prompt).
pub fn execute(templates: &Handlebars<'static>, ctx: &StagePromptContext<'_>) -> String {
    let template_ctx = UserMessageContext {
        stage_name: &ctx.stage.name,
        task_id: ctx.task_id,
        title: ctx.title,
        description: ctx.description,
        artifacts: &ctx.artifacts,
        question_history: &ctx.question_history,
        feedback: ctx.feedback,
        integration_error: ctx.integration_error.as_ref(),
        worktree_path: ctx.worktree_path,
        base_branch: ctx.base_branch,
        base_commit: ctx.base_commit,
        activity_logs: &ctx.activity_logs,
        workflow_stages: &ctx.workflow_stages,
        sibling_tasks: &ctx.sibling_tasks,
    };

    templates
        .render("initial_prompt", &template_ctx)
        .expect("initial_prompt template should render")
}

// -- Helpers --

/// Context for rendering the user message template (`initial_prompt.md`).
#[derive(Debug, Serialize)]
struct UserMessageContext<'a> {
    stage_name: &'a str,
    task_id: &'a str,
    title: &'a str,
    description: &'a str,
    artifacts: &'a [ArtifactContext<'a>],
    question_history: &'a [QuestionAnswerContext<'a>],
    feedback: Option<&'a str>,
    integration_error: Option<&'a IntegrationErrorContext<'a>>,
    worktree_path: Option<&'a str>,
    base_branch: &'a str,
    base_commit: &'a str,
    activity_logs: &'a [ActivityLogEntry],
    workflow_stages: &'a [WorkflowStageEntry],
    sibling_tasks: &'a [SiblingTaskContext],
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interactions::build::context::PromptBuilder;
    use orkestra_types::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use orkestra_types::domain::Task;
    use orkestra_types::runtime::Artifact;

    fn test_templates() -> Handlebars<'static> {
        let mut hb = Handlebars::new();
        hb.register_escape_fn(handlebars::no_escape);
        hb.register_template_string(
            "initial_prompt",
            include_str!("../../templates/initial_prompt.md"),
        )
        .unwrap();
        hb
    }

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_display_name("Planning")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary")
                .with_display_name("Working")
                .with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_display_name("Reviewing")
                .with_inputs(vec!["plan".into(), "summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
    }

    #[test]
    fn test_contains_task_context() {
        let templates = test_templates();
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new(
            "task-1",
            "Implement feature",
            "Add new feature",
            "work",
            "now",
        );
        task.artifacts.set(Artifact::new(
            "plan",
            "Step 1: Do this\nStep 2: Do that",
            "planning",
            "now",
        ));

        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(user_message.contains("task-1"));
        assert!(user_message.contains("Implement feature"));
        assert!(user_message.contains("Add new feature"));
        assert!(user_message.contains("Step 1: Do this"));
        assert!(user_message.contains("Input Artifacts"));
    }

    #[test]
    fn test_no_system_prompt_in_user_message() {
        let templates = test_templates();
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "work",
            "now",
        );
        task.artifacts.set(Artifact::new(
            "plan",
            "The implementation plan",
            "planning",
            "now",
        ));

        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(!user_message.contains("Output Format"));
        assert!(!user_message.contains("worker agent"));
        assert!(user_message.contains("Task ID"));
        assert!(user_message.contains("task-1"));
    }

    #[test]
    fn test_with_siblings() {
        let templates = test_templates();
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
            .build_context("planning", &task, None, None, false, Vec::new(), siblings)
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(user_message.contains("## Sibling Subtasks"));
        assert!(user_message.contains("This task is part of a breakdown"));
        assert!(user_message.contains("**bird** First subtask"));
        assert!(user_message.contains("(pending)"));
        assert!(user_message.contains("**cat** Second subtask"));
        assert!(user_message.contains("[this task depends on]"));
        assert!(user_message.contains("(done)"));
    }

    #[test]
    fn test_without_siblings() {
        let templates = test_templates();
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(!user_message.contains("## Sibling Subtasks"));
    }

    #[test]
    fn test_with_worktree() {
        let templates = test_templates();
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now")
            .with_worktree("/path/to/worktree/task-1")
            .with_base_branch("main")
            .with_base_commit("abc123def456");

        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(user_message.contains("Worktree Context"));
        assert!(user_message.contains("/path/to/worktree/task-1"));
        assert!(user_message.contains("branched from `main`"));
        assert!(user_message.contains("git diff --merge-base main"));
    }

    #[test]
    fn test_workflow_overview() {
        let templates = test_templates();
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict").with_description("Review the work"),
        ]);
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "work", "now");
        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(user_message.contains("## Your Workflow"));
        assert!(user_message.contains("[plan] — Create a plan"));
        assert!(user_message.contains("[work] ← YOU ARE HERE — Implement the plan"));
        assert!(user_message.contains("[review] — Review the work"));
    }
}
