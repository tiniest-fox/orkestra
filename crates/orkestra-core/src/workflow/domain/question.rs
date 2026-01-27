//! Question types for stage clarifications.
//!
//! Any stage with the `ask_questions` capability can ask clarifying questions
//! before producing its artifact. These types represent those questions and answers.

use serde::{Deserialize, Serialize};

/// A question from a stage asking for clarification.
///
/// Questions are stage-agnostic - any stage can ask them if it has
/// the `ask_questions` capability enabled.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Question {
    /// Unique identifier for this question.
    pub id: String,

    /// The question text.
    pub question: String,

    /// Additional context to help answer the question.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,

    /// Pre-defined options for the question.
    /// All questions should have options; the UI automatically adds an "Other" option
    /// for freeform responses.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<QuestionOption>,
}

impl Question {
    /// Create a new question.
    /// Note: Options should be added via `with_options()` or `with_option()`.
    /// All questions should have at least one option.
    pub fn new(id: impl Into<String>, question: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            question: question.into(),
            context: None,
            options: Vec::new(),
        }
    }

    /// Builder: add context.
    #[must_use]
    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = Some(context.into());
        self
    }

    /// Builder: add options for multiple choice.
    #[must_use]
    pub fn with_options(mut self, options: Vec<QuestionOption>) -> Self {
        self.options = options;
        self
    }

    /// Builder: add a single option.
    #[must_use]
    pub fn with_option(
        mut self,
        id: impl Into<String>,
        label: impl Into<String>,
        description: Option<&str>,
    ) -> Self {
        let mut option = QuestionOption::new(id, label);
        if let Some(desc) = description {
            option = option.with_description(desc);
        }
        self.options.push(option);
        self
    }
}

/// An option for a multiple choice question.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuestionOption {
    /// Unique identifier for this option.
    pub id: String,

    /// Display label for the option.
    pub label: String,

    /// Optional description explaining this option.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl QuestionOption {
    /// Create a new option.
    pub fn new(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            description: None,
        }
    }

    /// Builder: add description.
    #[must_use]
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }
}

/// An answer to a question.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuestionAnswer {
    /// ID of the question being answered.
    pub question_id: String,

    /// The original question text (stored for prompt context).
    pub question: String,

    /// The answer text (or option ID for multiple choice).
    pub answer: String,

    /// When the answer was provided (RFC3339).
    pub answered_at: String,
}

impl QuestionAnswer {
    /// Create a new answer.
    pub fn new(
        question_id: impl Into<String>,
        question: impl Into<String>,
        answer: impl Into<String>,
        answered_at: impl Into<String>,
    ) -> Self {
        Self {
            question_id: question_id.into(),
            question: question.into(),
            answer: answer.into(),
            answered_at: answered_at.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_question_new() {
        let q = Question::new("q1", "What is the target framework?");
        assert_eq!(q.id, "q1");
        assert_eq!(q.question, "What is the target framework?");
        assert!(q.context.is_none());
        assert!(q.options.is_empty());
    }

    #[test]
    fn test_question_with_context() {
        let q = Question::new("q1", "What framework?")
            .with_context("We need to know which framework to use for the implementation.");
        assert!(q.context.is_some());
        assert!(q.context.unwrap().contains("framework"));
    }

    #[test]
    fn test_question_with_options() {
        let q = Question::new("q1", "Which database?").with_options(vec![
            QuestionOption::new("postgres", "PostgreSQL"),
            QuestionOption::new("mysql", "MySQL"),
            QuestionOption::new("sqlite", "SQLite"),
        ]);
        assert_eq!(q.options.len(), 3);
    }

    #[test]
    fn test_question_option_with_description() {
        let opt = QuestionOption::new("postgres", "PostgreSQL")
            .with_description("Best for complex queries and JSONB support");
        assert!(opt.description.is_some());
    }

    #[test]
    fn test_question_answer() {
        let answer =
            QuestionAnswer::new("q1", "What database?", "PostgreSQL", "2025-01-24T10:00:00Z");
        assert_eq!(answer.question_id, "q1");
        assert_eq!(answer.question, "What database?");
        assert_eq!(answer.answer, "PostgreSQL");
    }

    #[test]
    fn test_question_serialization() {
        let q = Question::new("q1", "What framework?")
            .with_context("Context here")
            .with_options(vec![QuestionOption::new("react", "React")]);

        let json = serde_json::to_string(&q).unwrap();
        assert!(json.contains("\"id\":\"q1\""));
        assert!(json.contains("\"context\":\"Context here\""));
        assert!(json.contains("\"options\""));

        let parsed: Question = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, q);
    }

    #[test]
    fn test_question_yaml_serialization() {
        let q = Question::new("q1", "What framework?");
        let yaml = serde_yaml::to_string(&q).unwrap();
        assert!(yaml.contains("id: q1"));
        assert!(yaml.contains("question: What framework?"));
        // context and options should be omitted when empty/None
        assert!(!yaml.contains("context:"));
        assert!(!yaml.contains("options:"));

        let parsed: Question = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, q);
    }

    #[test]
    fn test_question_answer_serialization() {
        let answer = QuestionAnswer::new("q1", "What framework?", "React", "2025-01-24T10:00:00Z");
        let json = serde_json::to_string(&answer).unwrap();

        assert!(json.contains("\"question_id\":\"q1\""));
        assert!(json.contains("\"question\":\"What framework?\""));
        assert!(json.contains("\"answer\":\"React\""));

        let parsed: QuestionAnswer = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, answer);
    }
}
