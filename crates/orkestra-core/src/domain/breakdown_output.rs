//! Breakdown agent structured output types.
//!
//! The breakdown agent outputs JSON containing a breakdown plan
//! for decomposing a complex task into subtasks.

use serde::{Deserialize, Serialize};

use super::BreakdownPlan;

/// Output from the breakdown agent.
///
/// This wraps the existing `BreakdownPlan` type with a tagged enum
/// for consistent JSON output format across all agents.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum BreakdownOutput {
    /// Breakdown plan produced successfully.
    Breakdown {
        /// The breakdown plan with subtasks and rationale.
        plan: BreakdownPlan,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{PlannedSubtask, PlannedWorkItem, SubtaskComplexity};

    #[test]
    fn test_breakdown_output_serialization() {
        let output = BreakdownOutput::Breakdown {
            plan: BreakdownPlan {
                rationale: "Split into frontend and backend layers".to_string(),
                skip_breakdown: false,
                subtasks: vec![
                    PlannedSubtask {
                        temp_id: "st1".to_string(),
                        title: "Implement API endpoints".to_string(),
                        description: "Create REST endpoints for user management".to_string(),
                        complexity: SubtaskComplexity::Medium,
                        depends_on: vec![],
                        work_items: vec![PlannedWorkItem {
                            title: "Add user CRUD endpoints".to_string(),
                        }],
                    },
                    PlannedSubtask {
                        temp_id: "st2".to_string(),
                        title: "Build frontend components".to_string(),
                        description: "Create React components for user UI".to_string(),
                        complexity: SubtaskComplexity::Medium,
                        depends_on: vec!["st1".to_string()],
                        work_items: vec![],
                    },
                ],
            },
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"type\": \"breakdown\""));
        assert!(json.contains("Split into frontend"));
        assert!(json.contains("st1"));
        assert!(json.contains("st2"));

        // Round-trip
        let parsed: BreakdownOutput = serde_json::from_str(&json).unwrap();
        assert_eq!(output, parsed);
    }

    #[test]
    fn test_breakdown_output_skip() {
        let output = BreakdownOutput::Breakdown {
            plan: BreakdownPlan {
                rationale: "Task is simple enough to complete directly".to_string(),
                skip_breakdown: true,
                subtasks: vec![],
            },
        };

        let json = serde_json::to_string_pretty(&output).unwrap();
        assert!(json.contains("\"skip_breakdown\": true"));

        let parsed: BreakdownOutput = serde_json::from_str(&json).unwrap();
        match parsed {
            BreakdownOutput::Breakdown { plan } => {
                assert!(plan.skip_breakdown);
                assert!(plan.subtasks.is_empty());
            }
        }
    }
}
