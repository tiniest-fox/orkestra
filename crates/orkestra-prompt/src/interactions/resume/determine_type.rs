//! Resume type determination.
//!
//! Determines which resume prompt type to use based on available context.

use orkestra_types::domain::QuestionAnswer;

use crate::types::{IntegrationErrorContext, ResumeQuestionAnswer, ResumeType};

// ============================================================================
// Interaction
// ============================================================================

/// Determine the resume type from context.
///
/// Priority: `integration_error` > feedback > answers > continue
pub fn execute(
    feedback: Option<&str>,
    integration_error: Option<&IntegrationErrorContext<'_>>,
    question_history: &[QuestionAnswer],
) -> ResumeType {
    if let Some(err) = integration_error {
        ResumeType::Integration {
            message: err.message.to_string(),
            conflict_files: err
                .conflict_files
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
        }
    } else if let Some(fb) = feedback {
        ResumeType::UserMessage {
            message: fb.to_string(),
        }
    } else if !question_history.is_empty() {
        ResumeType::Answers {
            answers: question_history
                .iter()
                .map(|qa| ResumeQuestionAnswer {
                    question: qa.question.clone(),
                    answer: qa.answer.clone(),
                })
                .collect(),
        }
    } else {
        ResumeType::Continue
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_integration_takes_priority() {
        let error = IntegrationErrorContext {
            message: "conflict",
            conflict_files: vec!["file.rs"],
            base_branch: "main",
        };
        let answers = vec![QuestionAnswer::new("What?", "Something", "now")];
        let result = execute(Some("feedback"), Some(&error), &answers);
        assert!(matches!(result, ResumeType::Integration { .. }));
    }

    #[test]
    fn test_feedback_over_answers() {
        let answers = vec![QuestionAnswer::new("What?", "Something", "now")];
        let result = execute(Some("please fix"), None, &answers);
        match result {
            ResumeType::UserMessage { message } => assert_eq!(message, "please fix"),
            _ => panic!("Expected UserMessage variant"),
        }
    }

    #[test]
    fn test_answers() {
        let answers = vec![
            QuestionAnswer::new("Which DB?", "PostgreSQL", "now"),
            QuestionAnswer::new("Add cache?", "Yes", "now"),
        ];
        let result = execute(None, None, &answers);
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
    fn test_continue() {
        let result = execute(None, None, &[]);
        assert!(matches!(result, ResumeType::Continue));
    }
}
