//! Schema-validated example generators for prompt guidance.
//!
//! These functions generate JSON examples that are validated against
//! the actual schema components. If the schema changes and the examples
//! become invalid, tests will fail - ensuring examples stay in sync.

use jsonschema::Validator;
use serde_json::{json, Value};
use std::sync::LazyLock;

/// Schema for a single subtask item (extracted from subtasks.json).
static SUBTASK_ITEM_SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    let component: Value = serde_json::from_str(include_str!("schemas/components/subtasks.json"))
        .expect("subtasks.json should be valid");
    component["properties"]["subtasks"]["items"].clone()
});

/// Schema for a single question item (extracted from questions.json).
static QUESTION_ITEM_SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    let component: Value = serde_json::from_str(include_str!("schemas/components/questions.json"))
        .expect("questions.json should be valid");
    component["properties"]["questions"]["items"].clone()
});

/// Generate a validated subtask example JSON value.
///
/// Panics if the example doesn't match the schema (caught by tests).
pub fn subtask_example(title: &str, description: &str, depends_on: &[usize]) -> Value {
    let example = json!({
        "title": title,
        "description": description,
        "depends_on": depends_on
    });

    validate_against_schema(&example, &SUBTASK_ITEM_SCHEMA, "subtask");
    example
}

/// Generate a validated subtasks output example (the full output object).
pub fn subtasks_output_example(subtasks: &[Value], skip_reason: Option<&str>) -> String {
    let mut example = json!({
        "type": "subtasks",
        "subtasks": subtasks
    });
    if let Some(reason) = skip_reason {
        example["skip_reason"] = json!(reason);
    }
    serde_json::to_string(&example).unwrap()
}

/// Generate a validated question example JSON value.
///
/// Panics if the example doesn't match the schema (caught by tests).
pub fn question_example(question: &str, options: &[&str]) -> Value {
    let example = json!({
        "question": question,
        "options": options.iter().map(|o| json!({"label": o})).collect::<Vec<_>>()
    });

    validate_against_schema(&example, &QUESTION_ITEM_SCHEMA, "question");
    example
}

/// Generate a validated questions output example (the full output object).
pub fn questions_output_example(questions: &[Value]) -> String {
    let example = json!({
        "type": "questions",
        "questions": questions
    });
    serde_json::to_string(&example).unwrap()
}

/// Validate a value against a schema, panicking with helpful error if invalid.
fn validate_against_schema(value: &Value, schema: &Value, name: &str) {
    let validator = Validator::new(schema).expect("schema should be valid");
    let errors: Vec<String> = validator
        .iter_errors(value)
        .map(|e| format!("{} at {}", e, e.instance_path))
        .collect();

    if !errors.is_empty() {
        panic!(
            "{} example doesn't match schema!\nGenerated: {}\nErrors: {}",
            name,
            serde_json::to_string_pretty(value).unwrap(),
            errors.join("; ")
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subtask_example_valid() {
        // Should not panic
        let json = subtask_example("Task A", "Do the thing", &[]);
        assert_eq!(json["title"], "Task A");
        assert_eq!(json["description"], "Do the thing");
    }

    #[test]
    fn test_subtask_example_with_deps() {
        let json = subtask_example("Task B", "Depends on A", &[0]);
        assert_eq!(json["depends_on"], json!([0]));
    }

    #[test]
    fn test_subtask_example_multiple_deps() {
        let json = subtask_example("Integration", "Merge results", &[0, 1]);
        assert_eq!(json["depends_on"], json!([0, 1]));
    }

    #[test]
    fn test_subtasks_output_example() {
        let subtasks = vec![
            subtask_example("Task A", "First", &[]),
            subtask_example("Task B", "Second", &[0]),
        ];
        let output = subtasks_output_example(&subtasks, None);

        assert!(output.contains(r#""type":"subtasks""#));
        assert!(output.contains("Task A"));
        assert!(output.contains("Task B"));
        assert!(!output.contains("skip_reason"));
    }

    #[test]
    fn test_subtasks_output_with_skip() {
        let output = subtasks_output_example(&[], Some("Task is simple enough"));
        assert!(output.contains("skip_reason"));
        assert!(output.contains("Task is simple enough"));
    }

    #[test]
    fn test_question_example_valid() {
        let json = question_example("Which approach?", &["Option A", "Option B"]);
        assert_eq!(json["question"], "Which approach?");
        assert!(json["options"].is_array());
    }

    #[test]
    fn test_questions_output_example() {
        let questions = vec![question_example("What framework?", &["React", "Vue"])];
        let output = questions_output_example(&questions);

        assert!(output.contains(r#""type":"questions""#));
        assert!(output.contains("What framework?"));
    }
}
