//! Types for iterative planner questioning flow.
//!
//! The planner can ask clarifying questions before producing a plan.
//! These types model the question-answer cycle.

use serde::{Deserialize, Serialize};

/// An option for a planner question (like AskUserQuestion's options).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionOption {
    /// Short display label for the option
    pub label: String,
    /// Optional longer description explaining this choice
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A question asked by the planner to clarify requirements.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerQuestion {
    /// Unique identifier for this question (for matching answers)
    pub id: String,
    /// The question text
    pub question: String,
    /// Optional context explaining why this question is being asked
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Available options (user can also provide free-form "Other" response)
    pub options: Vec<QuestionOption>,
}

/// An answer to a planner question.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionAnswer {
    /// The question that was asked
    pub question: PlannerQuestion,
    /// The user's answer (either selected option label or free-form text)
    pub answer: String,
}

/// Structured plan output from the planner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredPlan {
    /// Brief overview of what will be done
    pub summary: String,
    /// List of files that will be modified
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_to_modify: Vec<String>,
    /// Numbered implementation steps
    pub implementation_steps: Vec<String>,
    /// How to verify the changes work
    #[serde(skip_serializing_if = "Option::is_none")]
    pub testing_strategy: Option<String>,
    /// Potential issues to watch for
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risks: Option<String>,
}

impl StructuredPlan {
    /// Convert the structured plan to markdown format.
    pub fn to_markdown(&self) -> String {
        let mut md = String::new();

        md.push_str("## Summary\n\n");
        md.push_str(&self.summary);
        md.push_str("\n\n");

        if !self.files_to_modify.is_empty() {
            md.push_str("## Files to Modify\n\n");
            for file in &self.files_to_modify {
                md.push_str(&format!("- {file}\n"));
            }
            md.push('\n');
        }

        md.push_str("## Implementation Steps\n\n");
        for (i, step) in self.implementation_steps.iter().enumerate() {
            md.push_str(&format!("{}. {step}\n", i + 1));
        }
        md.push('\n');

        if let Some(testing) = &self.testing_strategy {
            md.push_str("## Testing Strategy\n\n");
            md.push_str(testing);
            md.push_str("\n\n");
        }

        if let Some(risks) = &self.risks {
            md.push_str("## Risks/Considerations\n\n");
            md.push_str(risks);
            md.push('\n');
        }

        md
    }
}

/// Output from the planner - either questions or a plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PlannerOutput {
    /// Planner needs more information
    Questions { questions: Vec<PlannerQuestion> },
    /// Planner has produced a plan
    Plan { plan: StructuredPlan },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_planner_output_questions_serialization() {
        let output = PlannerOutput::Questions {
            questions: vec![PlannerQuestion {
                id: "q1".to_string(),
                question: "Which database should we use?".to_string(),
                context: Some("This affects the data layer design".to_string()),
                options: vec![
                    QuestionOption {
                        label: "PostgreSQL".to_string(),
                        description: Some("Relational, good for complex queries".to_string()),
                    },
                    QuestionOption {
                        label: "SQLite".to_string(),
                        description: Some("Simple, file-based".to_string()),
                    },
                ],
            }],
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"type\": \"questions\""));
        assert!(json.contains("Which database"));

        // Round-trip
        let parsed: PlannerOutput = serde_json::from_str(&json).unwrap();
        match parsed {
            PlannerOutput::Questions { questions } => {
                assert_eq!(questions.len(), 1);
                assert_eq!(questions[0].id, "q1");
            }
            _ => panic!("Expected Questions variant"),
        }
    }

    #[test]
    fn test_planner_output_plan_serialization() {
        let output = PlannerOutput::Plan {
            plan: StructuredPlan {
                summary: "Add user authentication".to_string(),
                files_to_modify: vec!["src/auth.rs".to_string()],
                implementation_steps: vec![
                    "Create auth module".to_string(),
                    "Add login endpoint".to_string(),
                ],
                testing_strategy: Some("Unit tests for auth logic".to_string()),
                risks: None,
            },
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"type\": \"plan\""));
        assert!(json.contains("Add user authentication"));

        // Round-trip
        let parsed: PlannerOutput = serde_json::from_str(&json).unwrap();
        match parsed {
            PlannerOutput::Plan { plan } => {
                assert_eq!(plan.summary, "Add user authentication");
                assert_eq!(plan.implementation_steps.len(), 2);
            }
            _ => panic!("Expected Plan variant"),
        }
    }

    #[test]
    fn test_structured_plan_to_markdown() {
        let plan = StructuredPlan {
            summary: "Add user authentication to the API".to_string(),
            files_to_modify: vec!["src/auth.rs".to_string(), "src/routes.rs".to_string()],
            implementation_steps: vec![
                "Create auth module with JWT handling".to_string(),
                "Add login/logout endpoints".to_string(),
                "Add middleware for protected routes".to_string(),
            ],
            testing_strategy: Some("Unit tests for JWT, integration tests for endpoints".to_string()),
            risks: Some("Token expiration handling needs careful testing".to_string()),
        };

        let md = plan.to_markdown();
        assert!(md.contains("## Summary"));
        assert!(md.contains("Add user authentication"));
        assert!(md.contains("## Files to Modify"));
        assert!(md.contains("- src/auth.rs"));
        assert!(md.contains("## Implementation Steps"));
        assert!(md.contains("1. Create auth module"));
        assert!(md.contains("## Testing Strategy"));
        assert!(md.contains("## Risks/Considerations"));
    }

    #[test]
    fn test_question_answer_serialization() {
        let qa = QuestionAnswer {
            question: PlannerQuestion {
                id: "q1".to_string(),
                question: "Which framework?".to_string(),
                context: None,
                options: vec![
                    QuestionOption {
                        label: "React".to_string(),
                        description: None,
                    },
                    QuestionOption {
                        label: "Vue".to_string(),
                        description: None,
                    },
                ],
            },
            answer: "React".to_string(),
        };

        let json = serde_json::to_string(&qa).unwrap();
        let parsed: QuestionAnswer = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.answer, "React");
        assert_eq!(parsed.question.id, "q1");
    }
}
