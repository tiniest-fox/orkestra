//! Centralized prompt templates using Handlebars.
//!
//! All agent prompts and system messages are defined as `.hbs` templates
//! in the `templates/` directory. This makes them easy to review, edit,
//! and maintain without digging through Rust code.

use handlebars::Handlebars;
use serde::Serialize;
use std::sync::LazyLock;

use crate::domain::Task;

// =============================================================================
// Embedded Templates
// =============================================================================

// Main agent prompts
const WORKER_TEMPLATE: &str = include_str!("templates/worker.hbs");
const PLANNER_TEMPLATE: &str = include_str!("templates/planner.hbs");
const REVIEWER_TEMPLATE: &str = include_str!("templates/reviewer.hbs");
const BREAKDOWN_TEMPLATE: &str = include_str!("templates/breakdown.hbs");
const TITLE_GENERATOR_TEMPLATE: &str = include_str!("templates/title_generator.hbs");

// Session resumption prompts
const RESUME_WORKER_TEMPLATE: &str = include_str!("templates/resume/worker.hbs");
const RESUME_PLANNER_TEMPLATE: &str = include_str!("templates/resume/planner.hbs");
const RESUME_REVIEWER_TEMPLATE: &str = include_str!("templates/resume/reviewer.hbs");
const RESUME_BREAKDOWN_TEMPLATE: &str = include_str!("templates/resume/breakdown.hbs");

// =============================================================================
// JSON Schemas (loaded from files)
// =============================================================================

// Component schemas (for composition)
const PLAN_SCHEMA: &str = include_str!("schemas/components/plan.json");
const QUESTIONS_SCHEMA: &str = include_str!("schemas/components/questions.json");

// Agent schemas (loaded from files)
/// JSON schema for breakdown output - used with Claude's --json-schema flag.
pub const BREAKDOWN_OUTPUT_SCHEMA: &str = include_str!("schemas/breakdown.json");

/// JSON schema for worker output - used with Claude's --json-schema flag.
pub const WORKER_OUTPUT_SCHEMA: &str = include_str!("schemas/worker.json");

/// JSON schema for reviewer output - used with Claude's --json-schema flag.
pub const REVIEWER_OUTPUT_SCHEMA: &str = include_str!("schemas/reviewer.json");

/// Composed planner schema (plan OR questions) - built at runtime from components.
/// The planner outputs either questions (needs more info) or a plan (ready).
pub static PLANNER_OUTPUT_SCHEMA: LazyLock<String> = LazyLock::new(|| {
    compose_planner_schema(PLAN_SCHEMA, QUESTIONS_SCHEMA)
});

/// Composes the planner schema from plan and questions components using oneOf.
fn compose_planner_schema(plan_schema: &str, questions_schema: &str) -> String {
    let plan: serde_json::Value = serde_json::from_str(plan_schema)
        .expect("plan.json should be valid JSON");
    let questions: serde_json::Value = serde_json::from_str(questions_schema)
        .expect("questions.json should be valid JSON");

    let composed = serde_json::json!({
        "type": "object",
        "description": "Planner output: either clarifying questions or an implementation plan",
        "oneOf": [plan, questions]
    });

    serde_json::to_string(&composed).expect("composed schema should serialize")
}

// =============================================================================
// Template Registry
// =============================================================================

static TEMPLATES: LazyLock<Handlebars<'static>> = LazyLock::new(|| {
    let mut hb = Handlebars::new();
    // Don't escape HTML - we're generating plain text prompts
    hb.register_escape_fn(handlebars::no_escape);

    // Main agent prompts
    hb.register_template_string("worker", WORKER_TEMPLATE)
        .expect("worker template");
    hb.register_template_string("planner", PLANNER_TEMPLATE)
        .expect("planner template");
    hb.register_template_string("reviewer", REVIEWER_TEMPLATE)
        .expect("reviewer template");
    hb.register_template_string("breakdown", BREAKDOWN_TEMPLATE)
        .expect("breakdown template");
    hb.register_template_string("title_generator", TITLE_GENERATOR_TEMPLATE)
        .expect("title_generator template");

    // Session resumption prompts
    hb.register_template_string("resume_worker", RESUME_WORKER_TEMPLATE)
        .expect("resume_worker template");
    hb.register_template_string("resume_planner", RESUME_PLANNER_TEMPLATE)
        .expect("resume_planner template");
    hb.register_template_string("resume_reviewer", RESUME_REVIEWER_TEMPLATE)
        .expect("resume_reviewer template");
    hb.register_template_string("resume_breakdown", RESUME_BREAKDOWN_TEMPLATE)
        .expect("resume_breakdown template");
    hb
});

// =============================================================================
// Context Structs
// =============================================================================

/// Context for worker session resumption.
#[derive(Serialize, Default)]
pub struct ResumeWorkerContext<'a> {
    /// Task ID for the completion command
    pub task_id: &'a str,
    /// Review feedback that needs to be addressed (if any)
    pub review_feedback: Option<&'a str>,
    /// Error message from a failed integration attempt (merge conflict)
    pub integration_error: Option<&'a str>,
    /// Files that had conflicts during integration
    pub conflict_files: Option<Vec<&'a str>>,
}

/// Context for planner session resumption.
#[derive(Serialize, Default)]
pub struct ResumePlannerContext<'a> {
    /// Task ID for the set-plan command
    pub task_id: &'a str,
    /// Plan feedback that needs to be addressed (if any)
    pub plan_feedback: Option<&'a str>,
    /// User's answers to the planner's questions (if resuming with answers)
    pub question_answers: Option<Vec<QuestionAnswerContext<'a>>>,
}

/// Context for a single question-answer pair in resume prompt.
#[derive(Serialize)]
pub struct QuestionAnswerContext<'a> {
    pub question: &'a str,
    pub answer: &'a str,
}

/// Context for reviewer session resumption.
#[derive(Serialize)]
pub struct ResumeReviewerContext<'a> {
    /// Task ID for the approve/reject commands
    pub task_id: &'a str,
}

/// Context for breakdown session resumption.
#[derive(Serialize, Default)]
pub struct ResumeBreakdownContext<'a> {
    /// Task ID for the breakdown commands
    pub task_id: &'a str,
    /// Breakdown feedback that needs to be addressed (if any)
    pub breakdown_feedback: Option<&'a str>,
}

/// Context for subtask items in worker prompt.
#[derive(Serialize)]
pub struct SubtaskContext<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub done: bool,
}

/// Context for work item items in worker prompt (three-level hierarchy).
#[derive(Serialize)]
pub struct WorkItemContext<'a> {
    pub title: &'a str,
    pub done: bool,
}

/// Context for worker agent prompts.
#[derive(Serialize)]
pub struct WorkerContext<'a> {
    pub agent_definition: &'a str,
    pub task_id: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub plan: Option<&'a str>,
    pub review_feedback: Option<&'a str>,
    pub subtasks: Option<Vec<SubtaskContext<'a>>>,
    pub work_items: Option<Vec<WorkItemContext<'a>>>,
}

/// Context for planner agent prompts.
#[derive(Serialize)]
pub struct PlannerContext<'a> {
    pub agent_definition: &'a str,
    pub task_id: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub plan_feedback: Option<&'a str>,
    /// History of questions and answers from the current planning session.
    pub question_history: Vec<crate::domain::QuestionAnswer>,
}

/// Context for reviewer agent prompts.
#[derive(Serialize)]
pub struct ReviewerContext<'a> {
    pub agent_definition: &'a str,
    pub task_id: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub plan: Option<&'a str>,
    pub summary: Option<&'a str>,
}

/// Context for breakdown agent prompts.
#[derive(Serialize)]
pub struct BreakdownContext<'a> {
    pub agent_definition: &'a str,
    pub task_id: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub plan: Option<&'a str>,
    pub breakdown_feedback: Option<&'a str>,
    pub auto_approve: bool,
}

/// Context for title generator prompts.
#[derive(Serialize)]
pub struct TitleGeneratorContext<'a> {
    pub description: &'a str,
}

// =============================================================================
// Render Functions
// =============================================================================

/// Renders a session resumption prompt.
/// Renders a worker session resumption prompt.
pub fn render_resume_worker(ctx: &ResumeWorkerContext) -> String {
    TEMPLATES
        .render("resume_worker", ctx)
        .expect("failed to render resume_worker template")
}

/// Renders a planner session resumption prompt.
pub fn render_resume_planner(ctx: &ResumePlannerContext) -> String {
    TEMPLATES
        .render("resume_planner", ctx)
        .expect("failed to render resume_planner template")
}

/// Renders a reviewer session resumption prompt.
pub fn render_resume_reviewer(ctx: &ResumeReviewerContext) -> String {
    TEMPLATES
        .render("resume_reviewer", ctx)
        .expect("failed to render resume_reviewer template")
}

/// Renders a breakdown session resumption prompt.
pub fn render_resume_breakdown(ctx: &ResumeBreakdownContext) -> String {
    TEMPLATES
        .render("resume_breakdown", ctx)
        .expect("failed to render resume_breakdown template")
}

/// Renders a worker agent prompt.
pub fn render_worker(ctx: &WorkerContext) -> String {
    TEMPLATES
        .render("worker", ctx)
        .expect("failed to render worker template")
}

/// Renders a planner agent prompt.
pub fn render_planner(ctx: &PlannerContext) -> String {
    TEMPLATES
        .render("planner", ctx)
        .expect("failed to render planner template")
}

/// Renders a reviewer agent prompt.
pub fn render_reviewer(ctx: &ReviewerContext) -> String {
    TEMPLATES
        .render("reviewer", ctx)
        .expect("failed to render reviewer template")
}

/// Renders a breakdown agent prompt.
pub fn render_breakdown(ctx: &BreakdownContext) -> String {
    TEMPLATES
        .render("breakdown", ctx)
        .expect("failed to render breakdown template")
}

/// Renders a title generator prompt.
pub fn render_title_generator(ctx: &TitleGeneratorContext) -> String {
    TEMPLATES
        .render("title_generator", ctx)
        .expect("failed to render title_generator template")
}

// =============================================================================
// Convenience Functions (from Task)
// =============================================================================

/// Gets the display title for a task, falling back to truncated description.
fn display_title(task: &Task) -> &str {
    task.title.as_deref().unwrap_or(&task.description)
}

/// Builds a worker prompt from a Task and agent definition.
pub fn build_worker_prompt(
    task: &Task,
    agent_definition: &str,
    subtasks: Option<&[Task]>,
) -> String {
    let subtask_contexts: Option<Vec<SubtaskContext>> = subtasks.map(|subs| {
        subs.iter()
            .map(|s| SubtaskContext {
                id: &s.id,
                title: display_title(s),
                description: &s.description,
                done: s.status == crate::domain::TaskStatus::Done,
            })
            .collect()
    });

    // Build work item contexts from the task's work_items field
    let work_item_contexts: Option<Vec<WorkItemContext>> = if task.work_items.is_empty() {
        None
    } else {
        Some(
            task.work_items
                .iter()
                .map(|wi| WorkItemContext {
                    title: &wi.title,
                    done: wi.done,
                })
                .collect(),
        )
    };

    render_worker(&WorkerContext {
        agent_definition,
        task_id: &task.id,
        title: display_title(task),
        description: &task.description,
        plan: task.plan.as_deref(),
        // Feedback is passed via resume prompts, not initial spawn
        review_feedback: None,
        subtasks: subtask_contexts,
        work_items: work_item_contexts,
    })
}

/// Builds a planner prompt from a Task and agent definition.
pub fn build_planner_prompt(task: &Task, agent_definition: &str) -> String {
    render_planner(&PlannerContext {
        agent_definition,
        task_id: &task.id,
        title: display_title(task),
        description: &task.description,
        // Feedback is passed via resume prompts, not initial spawn
        plan_feedback: None,
        // Include any previous Q&A history
        question_history: task.question_history.clone(),
    })
}

/// Builds a reviewer prompt from a Task and agent definition.
pub fn build_reviewer_prompt(task: &Task, agent_definition: &str) -> String {
    render_reviewer(&ReviewerContext {
        agent_definition,
        task_id: &task.id,
        title: display_title(task),
        description: &task.description,
        plan: task.plan.as_deref(),
        summary: task.summary.as_deref(),
    })
}

/// Builds a breakdown prompt from a Task and agent definition.
pub fn build_breakdown_prompt(task: &Task, agent_definition: &str) -> String {
    render_breakdown(&BreakdownContext {
        agent_definition,
        task_id: &task.id,
        title: display_title(task),
        description: &task.description,
        plan: task.plan.as_deref(),
        // Feedback is passed via resume prompts, not initial spawn
        breakdown_feedback: None,
        auto_approve: task.auto_approve,
    })
}

/// Builds a title generator prompt from a description.
pub fn build_title_generator_prompt(description: &str) -> String {
    render_title_generator(&TitleGeneratorContext { description })
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{TaskKind, TaskStatus};
    use crate::state::TaskPhase;

    fn create_test_task() -> Task {
        Task {
            id: "TASK-001".to_string(),
            title: Some("Test Task".to_string()),
            description: "Test description".to_string(),
            status: TaskStatus::Working,
            phase: TaskPhase::Idle,
            kind: TaskKind::Task,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            completed_at: None,
            summary: None,
            error: None,
            plan: None,
            pending_questions: Vec::new(),
            question_history: Vec::new(),
            sessions: None,
            auto_approve: false,
            parent_id: None,
            breakdown: None,
            skip_breakdown: false,
            agent_pid: None,
            branch_name: None,
            worktree_path: None,
            depends_on: Vec::new(),
            work_items: Vec::new(),
            assigned_worker_task_id: None,
        }
    }

    #[test]
    fn test_resume_worker_default() {
        let prompt = render_resume_worker(&ResumeWorkerContext {
            task_id: "TASK-001",
            review_feedback: None,
            integration_error: None,
            conflict_files: None,
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("continue implementing the task"));
    }

    #[test]
    fn test_resume_worker_with_feedback() {
        let prompt = render_resume_worker(&ResumeWorkerContext {
            task_id: "TASK-001",
            review_feedback: Some("Fix the bug in login"),
            integration_error: None,
            conflict_files: None,
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("Fix the bug in login"));
        // Now uses JSON output
        assert!(prompt.contains("output your completion status as JSON"));
    }

    #[test]
    fn test_resume_worker_with_integration_error() {
        let prompt = render_resume_worker(&ResumeWorkerContext {
            task_id: "TASK-001",
            review_feedback: None,
            integration_error: Some("Merge conflict during integration"),
            conflict_files: Some(vec!["src/main.rs", "Cargo.toml"]),
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("MERGE CONFLICT"));
        assert!(prompt.contains("Merge conflict during integration"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("Cargo.toml"));
        assert!(prompt.contains("git rebase"));
        // Now uses JSON output
        assert!(prompt.contains("Output your completion status as JSON"));
    }

    #[test]
    fn test_resume_planner_default() {
        let prompt = render_resume_planner(&ResumePlannerContext {
            task_id: "TASK-001",
            plan_feedback: None,
            question_answers: None,
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("continue creating the implementation plan"));
    }

    #[test]
    fn test_resume_planner_with_feedback() {
        let prompt = render_resume_planner(&ResumePlannerContext {
            task_id: "TASK-001",
            plan_feedback: Some("Add more detail to step 2"),
            question_answers: None,
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("Add more detail to step 2"));
    }

    #[test]
    fn test_resume_planner_with_question_answers() {
        let prompt = render_resume_planner(&ResumePlannerContext {
            task_id: "TASK-001",
            plan_feedback: None,
            question_answers: Some(vec![
                QuestionAnswerContext {
                    question: "Which approach?",
                    answer: "Use approach A",
                },
            ]),
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("Which approach?"));
        assert!(prompt.contains("Use approach A"));
    }

    #[test]
    fn test_resume_reviewer() {
        let prompt = render_resume_reviewer(&ResumeReviewerContext {
            task_id: "TASK-001",
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("continue reviewing"));
        // Now uses JSON output
        assert!(prompt.contains("output your review decision as JSON"));
    }

    #[test]
    fn test_resume_breakdown_default() {
        let prompt = render_resume_breakdown(&ResumeBreakdownContext {
            task_id: "TASK-001",
            breakdown_feedback: None,
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("continue breaking down"));
    }

    #[test]
    fn test_resume_breakdown_with_feedback() {
        let prompt = render_resume_breakdown(&ResumeBreakdownContext {
            task_id: "TASK-001",
            breakdown_feedback: Some("Split into smaller subtasks"),
        });
        assert!(prompt.contains("<!orkestra-resume>"));
        assert!(prompt.contains("Split into smaller subtasks"));
    }

    #[test]
    fn test_worker_basic() {
        let task = create_test_task();
        let prompt = build_worker_prompt(&task, "# Worker Agent", None);

        assert!(prompt.contains("# Worker Agent"));
        assert!(prompt.contains("TASK-001"));
        assert!(prompt.contains("Test Task"));
        // Worker now uses JSON output format
        assert!(prompt.contains("\"type\": \"completed\""));
        assert!(prompt.contains("\"type\": \"failed\""));
        assert!(prompt.contains("\"type\": \"blocked\""));
    }

    #[test]
    fn test_worker_with_plan() {
        let mut task = create_test_task();
        task.plan = Some("1. Do this\n2. Do that".to_string());

        let prompt = build_worker_prompt(&task, "# Agent", None);

        assert!(prompt.contains("Approved Implementation Plan"));
        assert!(prompt.contains("1. Do this"));
        assert!(prompt.contains("2. Do that"));
    }

    // Note: Feedback is passed via resume prompts, not initial spawn prompts.
    // See test_resume_worker_with_feedback for feedback testing.

    #[test]
    fn test_worker_with_subtasks() {
        let task = create_test_task();
        let mut subtask1 = create_test_task();
        subtask1.id = "TASK-002".to_string();
        subtask1.title = Some("First subtask".to_string());
        subtask1.description = "Do the first thing".to_string();
        subtask1.kind = TaskKind::Subtask;

        let mut subtask2 = create_test_task();
        subtask2.id = "TASK-003".to_string();
        subtask2.title = Some("Second subtask".to_string());
        subtask2.description = "Do the second thing".to_string();
        subtask2.kind = TaskKind::Subtask;
        subtask2.status = TaskStatus::Done;

        let subtasks = vec![subtask1, subtask2];
        let prompt = build_worker_prompt(&task, "# Agent", Some(&subtasks));

        assert!(prompt.contains("Subtasks Checklist"));
        assert!(prompt.contains("First subtask"));
        assert!(prompt.contains("Second subtask"));
        assert!(prompt.contains("[ ]")); // incomplete
        assert!(prompt.contains("[x]")); // complete
        assert!(prompt.contains("complete-subtask"));
    }

    #[test]
    fn test_planner_basic() {
        let task = create_test_task();
        let prompt = build_planner_prompt(&task, "# Planner Agent");

        assert!(prompt.contains("# Planner Agent"));
        assert!(prompt.contains("TASK-001"));
        assert!(prompt.contains("Test Task"));
        // Planner now uses JSON output, not CLI commands
        assert!(prompt.contains("valid JSON"));
    }

    // Note: Feedback is passed via resume prompts, not initial spawn prompts.
    // See test_resume_planner_with_feedback for feedback testing.

    #[test]
    fn test_planner_auto_approve() {
        let mut task = create_test_task();
        task.auto_approve = true;

        let prompt = build_planner_prompt(&task, "# Agent");

        // The planner.md agent definition doesn't contain AUTO-APPROVE anymore
        // as the planner uses structured JSON output, not CLI commands
        assert!(prompt.contains("# Agent"));
        assert!(prompt.contains("valid JSON"));
    }

    #[test]
    fn test_reviewer_basic() {
        let task = create_test_task();
        let prompt = build_reviewer_prompt(&task, "# Reviewer Agent");

        assert!(prompt.contains("# Reviewer Agent"));
        assert!(prompt.contains("TASK-001"));
        assert!(prompt.contains("Test Task"));
        // Reviewer now uses JSON output format
        assert!(prompt.contains("\"type\": \"approved\""));
        assert!(prompt.contains("\"type\": \"rejected\""));
    }

    #[test]
    fn test_reviewer_with_plan() {
        let mut task = create_test_task();
        task.plan = Some("1. Do this\n2. Do that".to_string());

        let prompt = build_reviewer_prompt(&task, "# Agent");

        assert!(prompt.contains("Approved Implementation Plan"));
        assert!(prompt.contains("1. Do this"));
        assert!(prompt.contains("2. Do that"));
    }

    #[test]
    fn test_reviewer_with_summary() {
        let mut task = create_test_task();
        task.summary = Some("Implemented the feature successfully".to_string());

        let prompt = build_reviewer_prompt(&task, "# Agent");

        assert!(prompt.contains("Work Summary"));
        assert!(prompt.contains("Implemented the feature successfully"));
    }

    #[test]
    fn test_breakdown_basic() {
        let task = create_test_task();
        let prompt = build_breakdown_prompt(&task, "# Breakdown Agent");

        assert!(prompt.contains("# Breakdown Agent"));
        assert!(prompt.contains("TASK-001"));
        // Breakdown now uses JSON output format
        assert!(prompt.contains("\"type\": \"breakdown\""));
        assert!(prompt.contains("skip_breakdown"));
    }

    #[test]
    fn test_breakdown_auto_approve() {
        let mut task = create_test_task();
        task.auto_approve = true;

        let prompt = build_breakdown_prompt(&task, "# Agent");

        assert!(prompt.contains("AUTO-APPROVE"));
        // Breakdown now uses JSON output format
        assert!(prompt.contains("\"type\": \"breakdown\""));
    }

    #[test]
    fn test_title_generator() {
        let prompt = build_title_generator_prompt("Fix the login button");

        assert!(prompt.contains("Fix the login button"));
        assert!(prompt.contains("3-8 words"));
        assert!(prompt.contains("sentence case"));
    }

    #[test]
    fn test_planner_schema_composition() {
        // Verify the composed schema is valid JSON with oneOf
        let schema: serde_json::Value =
            serde_json::from_str(&PLANNER_OUTPUT_SCHEMA).expect("schema should be valid JSON");

        assert_eq!(schema["type"], "object");
        assert!(schema["oneOf"].is_array());

        let one_of = schema["oneOf"].as_array().unwrap();
        assert_eq!(one_of.len(), 2);

        // One should be for "plan", one for "questions"
        let types: Vec<&str> = one_of
            .iter()
            .filter_map(|s| s["properties"]["type"]["const"].as_str())
            .collect();
        assert!(types.contains(&"plan"));
        assert!(types.contains(&"questions"));
    }

    #[test]
    fn test_schemas_are_valid_json() {
        // Verify all agent schemas are valid JSON
        let _: serde_json::Value =
            serde_json::from_str(BREAKDOWN_OUTPUT_SCHEMA).expect("breakdown schema should be valid");
        let _: serde_json::Value =
            serde_json::from_str(WORKER_OUTPUT_SCHEMA).expect("worker schema should be valid");
        let _: serde_json::Value =
            serde_json::from_str(REVIEWER_OUTPUT_SCHEMA).expect("reviewer schema should be valid");
    }
}
