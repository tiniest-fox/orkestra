use crate::domain::Task;

/// Builds the prompt for a worker agent.
pub fn build_worker_prompt(task: &Task, agent_definition: &str) -> String {
    let plan_section = if let Some(plan) = &task.plan {
        format!(
            r#"

## Approved Implementation Plan

Follow this plan that was approved by the user:

{}
"#,
            plan
        )
    } else {
        String::new()
    };

    let review_feedback_section = if let Some(feedback) = &task.review_feedback {
        format!(
            r#"

## Review Feedback

The reviewer has requested changes to your work:

{}

Please address this feedback and continue your implementation."#,
            feedback
        )
    } else {
        String::new()
    };

    format!(
        r#"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{plan_section}{review_feedback_section}
---

Remember: When you are done, you MUST run one of these commands:
- `ork task complete {task_id} --summary "what you did"` - if successful
- `ork task fail {task_id} --reason "why"` - if you cannot complete it
- `ork task block {task_id} --reason "what you need"` - if you need clarification
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        review_feedback_section = review_feedback_section,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::TaskStatus;

    fn create_test_task() -> Task {
        Task {
            id: "TASK-001".to_string(),
            title: "Test Task".to_string(),
            description: "Test description".to_string(),
            status: TaskStatus::Working,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            completed_at: None,
            summary: None,
            error: None,
            agent_pid: None,
            plan: None,
            plan_feedback: None,
            review_feedback: None,
            sessions: None,
            auto_approve: false,
        }
    }

    #[test]
    fn test_basic_prompt() {
        let task = create_test_task();
        let prompt = build_worker_prompt(&task, "# Worker Agent");

        assert!(prompt.contains("# Worker Agent"));
        assert!(prompt.contains("TASK-001"));
        assert!(prompt.contains("Test Task"));
        assert!(prompt.contains("ork task complete"));
        assert!(prompt.contains("ork task fail"));
        assert!(prompt.contains("ork task block"));
    }

    #[test]
    fn test_with_plan() {
        let mut task = create_test_task();
        task.plan = Some("1. Do this\n2. Do that".to_string());

        let prompt = build_worker_prompt(&task, "# Agent");

        assert!(prompt.contains("Approved Implementation Plan"));
        assert!(prompt.contains("1. Do this"));
        assert!(prompt.contains("2. Do that"));
    }

    #[test]
    fn test_with_review_feedback() {
        let mut task = create_test_task();
        task.review_feedback = Some("Fix the bug".to_string());

        let prompt = build_worker_prompt(&task, "# Agent");

        assert!(prompt.contains("Review Feedback"));
        assert!(prompt.contains("Fix the bug"));
    }
}
