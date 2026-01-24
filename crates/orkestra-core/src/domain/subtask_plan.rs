//! Subtask plan types for plan-first breakdown workflow.
//!
//! The breakdown agent outputs a `BreakdownPlan` containing proposed subtasks.
//! Users review and approve the plan, then subtasks are created from it.

use serde::{Deserialize, Serialize};

/// A planned subtask within a breakdown plan (not yet created as a Task).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlannedSubtask {
    /// Temporary ID for dependency references (e.g., "st1", "st2").
    /// Maps to real task IDs when subtasks are created on approval.
    pub temp_id: String,

    /// Title of the subtask.
    pub title: String,

    /// Description with acceptance criteria.
    pub description: String,

    /// Estimated complexity for scheduling hints.
    #[serde(default)]
    pub complexity: SubtaskComplexity,

    /// IDs of subtasks this depends on (references temp_id of other subtasks).
    #[serde(default)]
    pub depends_on: Vec<String>,

    /// Work items - simple checklist within this subtask.
    #[serde(default)]
    pub work_items: Vec<PlannedWorkItem>,
}

/// Complexity estimate for scheduling hints.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SubtaskComplexity {
    #[default]
    Small,
    Medium,
    Large,
}

/// A simple checklist item within a subtask (not a full task).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlannedWorkItem {
    /// Description of the work item.
    pub title: String,
}

/// The complete breakdown plan stored on a task.
/// Produced by the breakdown agent, reviewed by user, then executed by system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BreakdownPlan {
    /// Reasoning for how the task was decomposed.
    pub rationale: String,

    /// Planned subtasks with dependencies.
    pub subtasks: Vec<PlannedSubtask>,

    /// Whether the plan recommends skipping breakdown (task is simple).
    #[serde(default)]
    pub skip_breakdown: bool,
}

/// A work item within a subtask (runtime version, stored on Task).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkItem {
    /// Description of the work item.
    pub title: String,

    /// Whether this work item is complete.
    #[serde(default)]
    pub done: bool,
}

impl From<&PlannedWorkItem> for WorkItem {
    fn from(planned: &PlannedWorkItem) -> Self {
        WorkItem {
            title: planned.title.clone(),
            done: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_breakdown_plan_serialization() {
        let plan = BreakdownPlan {
            rationale: "Split into domain and persistence layers".to_string(),
            skip_breakdown: false,
            subtasks: vec![
                PlannedSubtask {
                    temp_id: "st1".to_string(),
                    title: "Implement domain model".to_string(),
                    description: "Create structs for the domain".to_string(),
                    complexity: SubtaskComplexity::Medium,
                    depends_on: vec![],
                    work_items: vec![
                        PlannedWorkItem {
                            title: "Add WorkItem struct".to_string(),
                        },
                        PlannedWorkItem {
                            title: "Add BreakdownPlan struct".to_string(),
                        },
                    ],
                },
                PlannedSubtask {
                    temp_id: "st2".to_string(),
                    title: "Add database migration".to_string(),
                    description: "Add columns to tasks table".to_string(),
                    complexity: SubtaskComplexity::Small,
                    depends_on: vec!["st1".to_string()],
                    work_items: vec![],
                },
            ],
        };

        let json = serde_json::to_string_pretty(&plan).unwrap();
        let parsed: BreakdownPlan = serde_json::from_str(&json).unwrap();
        assert_eq!(plan, parsed);
    }

    #[test]
    fn test_work_item_from_planned() {
        let planned = PlannedWorkItem {
            title: "Test item".to_string(),
        };
        let work_item = WorkItem::from(&planned);
        assert_eq!(work_item.title, "Test item");
        assert!(!work_item.done);
    }

    #[test]
    fn test_complexity_default() {
        assert_eq!(SubtaskComplexity::default(), SubtaskComplexity::Small);
    }

    #[test]
    fn test_skip_breakdown_plan() {
        let plan = BreakdownPlan {
            rationale: "Task is simple, no breakdown needed".to_string(),
            skip_breakdown: true,
            subtasks: vec![],
        };

        let json = serde_json::to_string(&plan).unwrap();
        let parsed: BreakdownPlan = serde_json::from_str(&json).unwrap();
        assert!(parsed.skip_breakdown);
        assert!(parsed.subtasks.is_empty());
    }
}
