//! Dynamic prompt section extraction.
//!
//! Inspects a `StagePromptContext` and returns one `PromptSection` per populated
//! dynamic field. Used to attach structured section data to `UserMessage` log entries.

use orkestra_types::domain::PromptSection;

use crate::types::StagePromptContext;

/// Extract dynamic sections from a stage prompt context.
///
/// Returns one entry per populated dynamic field: feedback, integration error,
/// sibling tasks, resources, and question history. Returns an empty vec when none
/// of these fields carry content (plain fresh spawn with no extra context).
pub fn execute(ctx: &StagePromptContext<'_>) -> Vec<PromptSection> {
    let mut sections = Vec::new();

    if let Some(feedback) = ctx.feedback {
        sections.push(PromptSection {
            label: "Feedback to Address".to_string(),
            content: feedback.to_string(),
        });
    }

    if let Some(err) = &ctx.integration_error {
        sections.push(PromptSection {
            label: "Merge Conflict".to_string(),
            content: err.message.to_string(),
        });
    }

    if !ctx.sibling_tasks.is_empty() {
        let content = ctx
            .sibling_tasks
            .iter()
            .map(|s| format!("{} — {}", s.short_id, s.title))
            .collect::<Vec<_>>()
            .join(", ");
        sections.push(PromptSection {
            label: "Sibling Subtraks".to_string(),
            content,
        });
    }

    if !ctx.resources.is_empty() {
        let content = ctx
            .resources
            .iter()
            .map(|r| r.name.clone())
            .collect::<Vec<_>>()
            .join(", ");
        sections.push(PromptSection {
            label: "Resources".to_string(),
            content,
        });
    }

    if !ctx.question_history.is_empty() {
        sections.push(PromptSection {
            label: "Previous Questions and Answers".to_string(),
            content: format!("{} question(s)", ctx.question_history.len()),
        });
    }

    sections
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interactions::build::context::PromptBuilder;
    use crate::types::IntegrationErrorContext;
    use orkestra_types::config::{StageConfig, WorkflowConfig};
    use orkestra_types::domain::Task;
    use orkestra_types::runtime::Resource;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
    }

    fn base_task() -> Task {
        Task::new("task-1", "Test", "Description", "work", "now")
    }

    #[test]
    fn test_empty_context_returns_no_sections() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let task = base_task();
        let ctx = builder
            .build_context("work", &task, &[], None, None, false, &[], None)
            .unwrap();

        let sections = execute(&ctx);
        assert!(
            sections.is_empty(),
            "Expected no sections for plain context"
        );
    }

    #[test]
    fn test_feedback_produces_section() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let task = base_task();
        let ctx = builder
            .build_context(
                "work",
                &task,
                &[],
                Some("Please fix the bug"),
                None,
                false,
                &[],
                None,
            )
            .unwrap();

        let sections = execute(&ctx);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].label, "Feedback to Address");
        assert_eq!(sections[0].content, "Please fix the bug");
    }

    #[test]
    fn test_integration_error_produces_section() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let task = base_task();
        let integration_error = IntegrationErrorContext {
            message: "Merge conflict in src/main.rs",
            conflict_files: vec!["src/main.rs"],
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
                None,
            )
            .unwrap();

        let sections = execute(&ctx);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].label, "Merge Conflict");
        assert_eq!(sections[0].content, "Merge conflict in src/main.rs");
    }

    #[test]
    fn test_resources_produce_section() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let mut task = base_task();
        task.resources.set(Resource::new(
            "design-doc",
            Some("https://example.com"),
            Some("Architecture decision"),
            "work",
            "now",
        ));
        let ctx = builder
            .build_context("work", &task, &[], None, None, false, &[], None)
            .unwrap();

        let sections = execute(&ctx);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].label, "Resources");
        assert!(sections[0].content.contains("design-doc"));
    }

    #[test]
    fn test_multiple_dynamic_fields_produce_multiple_sections() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let mut task = base_task();
        task.resources.set(Resource::new(
            "doc",
            None::<String>,
            Some("desc"),
            "work",
            "now",
        ));
        let ctx = builder
            .build_context(
                "work",
                &task,
                &[],
                Some("Fix the test"),
                None,
                false,
                &[],
                None,
            )
            .unwrap();

        let sections = execute(&ctx);
        assert_eq!(sections.len(), 2);
        let labels: Vec<&str> = sections.iter().map(|s| s.label.as_str()).collect();
        assert!(labels.contains(&"Feedback to Address"));
        assert!(labels.contains(&"Resources"));
    }
}
