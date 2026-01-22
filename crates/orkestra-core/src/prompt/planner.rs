use crate::domain::Task;

/// Builds the prompt for a planner agent.
pub fn build_planner_prompt(task: &Task, agent_definition: &str) -> String {
    let feedback_section = if let Some(feedback) = &task.plan_feedback {
        format!(
            r"

## Previous Plan Feedback

The user has requested changes to the previous plan:

{feedback}

Please revise your plan to address this feedback.
"
        )
    } else {
        String::new()
    };

    let completion_instructions = if task.auto_approve {
        format!(
            r#"Remember: This task has AUTO-APPROVE enabled. When your plan is ready, you MUST run BOTH commands in sequence:
1. `ork task set-plan {task_id} --plan "YOUR_MARKDOWN_PLAN"`
2. `ork task approve {task_id}`

The second command will automatically start the worker agent to implement your plan."#,
            task_id = task.id
        )
    } else {
        format!(
            r#"Remember: When your plan is ready, you MUST run:
`ork task set-plan {task_id} --plan "YOUR_MARKDOWN_PLAN"`"#,
            task_id = task.id
        )
    };

    format!(
        r"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{feedback_section}
---

{completion_instructions}
",
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        feedback_section = feedback_section,
        completion_instructions = completion_instructions,
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
            status: TaskStatus::Planning,
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
        }
    }

    #[test]
    fn test_basic_prompt() {
        let task = create_test_task();
        let prompt = build_planner_prompt(&task, "# Agent Definition");

        assert!(prompt.contains("# Agent Definition"));
        assert!(prompt.contains("TASK-001"));
        assert!(prompt.contains("Test Task"));
        assert!(prompt.contains("Test description"));
        assert!(prompt.contains("ork task set-plan"));
    }

    #[test]
    fn test_with_feedback() {
        let mut task = create_test_task();
        task.plan_feedback = Some("Please add more detail".to_string());

        let prompt = build_planner_prompt(&task, "# Agent");

        assert!(prompt.contains("Previous Plan Feedback"));
        assert!(prompt.contains("Please add more detail"));
    }

    #[test]
    fn test_auto_approve() {
        let mut task = create_test_task();
        task.auto_approve = true;

        let prompt = build_planner_prompt(&task, "# Agent");

        assert!(prompt.contains("AUTO-APPROVE"));
        assert!(prompt.contains("ork task approve"));
    }
}
