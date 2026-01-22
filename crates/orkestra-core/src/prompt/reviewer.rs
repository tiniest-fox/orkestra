use crate::domain::Task;

/// Builds the prompt for a reviewer agent.
///
/// The reviewer agent performs automated code review, runs checks,
/// and either approves the implementation or rejects it with feedback.
pub fn build_reviewer_prompt(task: &Task, agent_definition: &str) -> String {
    let plan_section = if let Some(plan) = &task.plan {
        format!(
            r"

## Approved Implementation Plan

The worker followed this plan:

{plan}
"
        )
    } else {
        String::new()
    };

    let summary_section = if let Some(summary) = &task.summary {
        format!(
            r"

## Work Summary

The worker completed the implementation with this summary:

{summary}
"
        )
    } else {
        String::new()
    };

    format!(
        r#"{agent_definition}

---

## Task Under Review

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{plan_section}{summary_section}
---

## Your Review Commands

When you are done reviewing, you MUST run ONE of these commands:
- `ork task approve-review {task_id}` - if the implementation passes all checks and review
- `ork task reject-review {task_id} --feedback "specific feedback for the worker"` - if issues need to be fixed

If you reject, provide clear, actionable feedback so the worker knows exactly what to fix.
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        summary_section = summary_section,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{TaskKind, TaskStatus};

    fn create_test_task() -> Task {
        Task {
            id: "TASK-001".to_string(),
            title: "Test Task".to_string(),
            description: "Test description".to_string(),
            status: TaskStatus::Reviewing,
            kind: TaskKind::Task,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            completed_at: None,
            summary: None,
            error: None,
            plan: None,
            plan_feedback: None,
            review_feedback: None,
            reviewer_feedback: None,
            sessions: None,
            auto_approve: false,
            parent_id: None,
            breakdown: None,
            breakdown_feedback: None,
            skip_breakdown: false,
            agent_pid: None,
            branch_name: None,
            worktree_path: None,
            integration_result: None,
        }
    }

    #[test]
    fn test_basic_prompt() {
        let task = create_test_task();
        let prompt = build_reviewer_prompt(&task, "# Reviewer Agent");

        assert!(prompt.contains("# Reviewer Agent"));
        assert!(prompt.contains("TASK-001"));
        assert!(prompt.contains("Test Task"));
        assert!(prompt.contains("Test description"));
        assert!(prompt.contains("ork task approve-review"));
        assert!(prompt.contains("ork task reject-review"));
    }

    #[test]
    fn test_with_plan() {
        let mut task = create_test_task();
        task.plan = Some("1. Do this\n2. Do that".to_string());

        let prompt = build_reviewer_prompt(&task, "# Agent");

        assert!(prompt.contains("Approved Implementation Plan"));
        assert!(prompt.contains("1. Do this"));
        assert!(prompt.contains("2. Do that"));
    }

    #[test]
    fn test_with_summary() {
        let mut task = create_test_task();
        task.summary = Some("Implemented the feature successfully".to_string());

        let prompt = build_reviewer_prompt(&task, "# Agent");

        assert!(prompt.contains("Work Summary"));
        assert!(prompt.contains("Implemented the feature successfully"));
    }

    #[test]
    fn test_with_plan_and_summary() {
        let mut task = create_test_task();
        task.plan = Some("1. Add validation".to_string());
        task.summary = Some("Added input validation".to_string());

        let prompt = build_reviewer_prompt(&task, "# Agent");

        assert!(prompt.contains("Approved Implementation Plan"));
        assert!(prompt.contains("1. Add validation"));
        assert!(prompt.contains("Work Summary"));
        assert!(prompt.contains("Added input validation"));
    }
}
