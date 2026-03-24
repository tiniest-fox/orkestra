//! User message construction.
//!
//! Builds the user message from task context using the `initial_prompt` template.

use handlebars::Handlebars;
use serde::Serialize;

use crate::types::{
    ArtifactContext, IntegrationErrorContext, QuestionAnswerContext, SiblingTaskContext,
    StagePromptContext, WorkflowStageEntry,
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
    artifacts: &'a [ArtifactContext],
    question_history: &'a [QuestionAnswerContext<'a>],
    feedback: Option<&'a str>,
    integration_error: Option<&'a IntegrationErrorContext<'a>>,
    worktree_path: Option<&'a str>,
    base_branch: &'a str,
    base_commit: &'a str,
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
            StageConfig::new("work", "summary").with_display_name("Working"),
            StageConfig::new("review", "verdict")
                .with_display_name("Reviewing")
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
    }

    #[test]
    fn test_contains_task_context() {
        let templates = test_templates();
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new(
            "task-1",
            "Implement feature",
            "Add new feature",
            "work",
            "now",
        );

        // Pass artifact names (artifacts are materialized to files before spawn)
        let artifact_names = vec!["plan".to_string()];
        let ctx = builder
            .build_context("work", &task, &artifact_names, None, None, false, &[])
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(user_message.contains("task-1"));
        assert!(user_message.contains("Implement feature"));
        assert!(user_message.contains("Add new feature"));
        // Artifacts now show file paths instead of content
        assert!(user_message.contains(".orkestra/.artifacts/plan.md"));
        assert!(user_message.contains("Input Artifacts"));
    }

    #[test]
    fn test_no_system_prompt_in_user_message() {
        let templates = test_templates();
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
            .build_context("planning", &task, &[], None, None, false, &siblings)
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
            .build_context("planning", &task, &[], None, None, false, &[])
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
            .build_context("planning", &task, &[], None, None, false, &[])
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
            .build_context("work", &task, &[], None, None, false, &[])
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(user_message.contains("## Your Workflow"));
        assert!(user_message.contains("[plan] — Create a plan"));
        assert!(user_message.contains("[work] ← YOU ARE HERE — Implement the plan"));
        assert!(user_message.contains("[review] — Review the work"));
    }

    #[test]
    fn test_workflow_overview_shows_artifact_path_for_prior_stages() {
        let templates = test_templates();
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict").with_description("Review the work"),
        ]);
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "work", "now")
            .with_worktree("/worktrees/task-1");
        // "plan" artifact is materialized; current stage is "work".
        let artifact_names = vec!["plan".to_string()];
        let ctx = builder
            .build_context("work", &task, &artifact_names, None, None, false, &[])
            .unwrap();

        let user_message = execute(&templates, &ctx);

        // Prior stage with materialized artifact shows its path.
        assert!(
            user_message.contains("/worktrees/task-1/.orkestra/.artifacts/plan.md"),
            "expected artifact path in workflow overview, got:\n{user_message}"
        );
        // Current and future stages do not show artifact paths.
        assert!(!user_message.contains(".orkestra/.artifacts/summary.md"));
        assert!(!user_message.contains(".orkestra/.artifacts/verdict.md"));
    }

    #[test]
    fn test_integration_error_auto_merge() {
        let templates = test_templates();
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "work", "now")
            .with_worktree("/path/to/worktree")
            .with_base_branch("main");

        let integration_error = IntegrationErrorContext {
            message: "Merge conflict detected",
            conflict_files: vec!["src/main.rs", "src/lib.rs"],
            base_branch: "main",
        };

        let ctx = builder
            .build_context(
                "work",
                &task,
                &[],
                None,
                Some(integration_error),
                false,
                &[],
            )
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(user_message.contains("MERGE CONFLICT"));
        assert!(user_message.contains("Merge conflict detected"));
        assert!(user_message.contains("src/main.rs"));
        assert!(user_message.contains("src/lib.rs"));
        assert!(user_message.contains("merge is in progress"));
        assert!(!user_message.contains("git fetch origin"));
    }

    #[test]
    fn test_integration_error_pr_path() {
        let templates = test_templates();
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "work", "now")
            .with_worktree("/path/to/worktree")
            .with_base_branch("main");

        let integration_error = IntegrationErrorContext {
            message: "PR has merge conflicts",
            conflict_files: vec![],
            base_branch: "main",
        };

        let ctx = builder
            .build_context(
                "work",
                &task,
                &[],
                None,
                Some(integration_error),
                false,
                &[],
            )
            .unwrap();

        let user_message = execute(&templates, &ctx);

        assert!(user_message.contains("MERGE CONFLICT"));
        assert!(user_message.contains("PR has merge conflicts"));
        assert!(!user_message.contains("merge is in progress"));
        assert!(user_message.contains("git fetch origin && git merge origin/main"));
    }
}
