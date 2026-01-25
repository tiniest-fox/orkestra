//! Agent output schemas and title generation prompt.
//!
//! This module provides:
//! - JSON schemas for agent structured output (planner, breakdown, worker, reviewer)
//! - Title generator prompt template

use handlebars::Handlebars;
use serde::Serialize;
use std::sync::LazyLock;

// =============================================================================
// JSON Schemas (loaded from files)
// =============================================================================

// Component schemas (for composition)
const PLAN_SCHEMA: &str = include_str!("schemas/components/plan.json");
const QUESTIONS_SCHEMA: &str = include_str!("schemas/components/questions.json");

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
    let plan: serde_json::Value =
        serde_json::from_str(plan_schema).expect("plan.json should be valid JSON");
    let questions: serde_json::Value =
        serde_json::from_str(questions_schema).expect("questions.json should be valid JSON");

    let composed = serde_json::json!({
        "type": "object",
        "description": "Planner output: either clarifying questions or an implementation plan",
        "oneOf": [plan, questions]
    });

    serde_json::to_string(&composed).expect("composed schema should serialize")
}

// =============================================================================
// Title Generator
// =============================================================================

const TITLE_GENERATOR_TEMPLATE: &str = include_str!("templates/title_generator.hbs");

static TEMPLATES: LazyLock<Handlebars<'static>> = LazyLock::new(|| {
    let mut hb = Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.register_template_string("title_generator", TITLE_GENERATOR_TEMPLATE)
        .expect("title_generator template");
    hb
});

#[derive(Serialize)]
struct TitleGeneratorContext<'a> {
    description: &'a str,
}

fn render_title_generator(ctx: &TitleGeneratorContext<'_>) -> String {
    TEMPLATES
        .render("title_generator", ctx)
        .expect("title_generator template should render")
}

/// Build a prompt for the title generator agent.
pub fn build_title_generator_prompt(description: &str) -> String {
    render_title_generator(&TitleGeneratorContext { description })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_planner_schema_composition() {
        let schema = PLANNER_OUTPUT_SCHEMA.as_str();
        let parsed: serde_json::Value = serde_json::from_str(schema).unwrap();
        assert!(parsed.get("oneOf").is_some());
    }

    #[test]
    fn test_title_generator_prompt() {
        let prompt = build_title_generator_prompt("Fix the bug in login");
        assert!(prompt.contains("Fix the bug in login"));
    }
}
