use crate::domain::Task;

/// Builds the prompt for a worker agent.
///
/// If subtasks (checklist items) are provided, they are included in the prompt
/// and the worker is instructed to complete them in order.
pub fn build_worker_prompt(
    task: &Task,
    agent_definition: &str,
    subtasks: Option<&[Task]>,
) -> String {
    let plan_section = if let Some(plan) = &task.plan {
        format!(
            r"

## Approved Implementation Plan

Follow this plan that was approved by the user:

{plan}
"
        )
    } else {
        String::new()
    };

    let review_feedback_section = if let Some(feedback) = &task.review_feedback {
        format!(
            r"

## Review Feedback

The reviewer has requested changes to your work:

{feedback}

Please address this feedback and continue your implementation."
        )
    } else {
        String::new()
    };

    let subtasks_section = if let Some(subs) = subtasks {
        if subs.is_empty() {
            String::new()
        } else {
            use std::fmt::Write;
            let checklist: String = subs
                .iter()
                .fold(String::new(), |mut acc, s| {
                    let status_marker = if s.status == crate::domain::TaskStatus::Done {
                        "x"
                    } else {
                        " "
                    };
                    let _ = writeln!(
                        acc,
                        "- [{}] **{}**: {} (ID: {})",
                        status_marker, s.title, s.description, s.id
                    );
                    acc
                });
            format!(
                r"

## Subtasks Checklist

Work through these subtasks in order. Mark each complete as you finish:

{checklist}
To mark a subtask complete, run: `ork task complete-subtask SUBTASK_ID`
"
            )
        }
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
{plan_section}{subtasks_section}{review_feedback_section}
---

Remember: When you are done with ALL work, you MUST run one of these commands:
- `ork task complete {task_id} --summary "what you did"` - if successful
- `ork task fail {task_id} --reason "why"` - if you cannot complete it
- `ork task block {task_id} --reason "what you need"` - if you need clarification
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        subtasks_section = subtasks_section,
        review_feedback_section = review_feedback_section,
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
            status: TaskStatus::Working,
            kind: TaskKind::Task,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            completed_at: None,
            summary: None,
            error: None,
            plan: None,
            plan_feedback: None,
            review_feedback: None,
            sessions: None,
            auto_approve: false,
            parent_id: None,
            breakdown: None,
            breakdown_feedback: None,
            skip_breakdown: false,
        }
    }

    #[test]
    fn test_basic_prompt() {
        let task = create_test_task();
        let prompt = build_worker_prompt(&task, "# Worker Agent", None);

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

        let prompt = build_worker_prompt(&task, "# Agent", None);

        assert!(prompt.contains("Approved Implementation Plan"));
        assert!(prompt.contains("1. Do this"));
        assert!(prompt.contains("2. Do that"));
    }

    #[test]
    fn test_with_review_feedback() {
        let mut task = create_test_task();
        task.review_feedback = Some("Fix the bug".to_string());

        let prompt = build_worker_prompt(&task, "# Agent", None);

        assert!(prompt.contains("Review Feedback"));
        assert!(prompt.contains("Fix the bug"));
    }

    #[test]
    fn test_with_subtasks() {
        let task = create_test_task();
        let mut subtask1 = create_test_task();
        subtask1.id = "TASK-002".to_string();
        subtask1.title = "First subtask".to_string();
        subtask1.description = "Do the first thing".to_string();
        subtask1.kind = TaskKind::Subtask;

        let mut subtask2 = create_test_task();
        subtask2.id = "TASK-003".to_string();
        subtask2.title = "Second subtask".to_string();
        subtask2.description = "Do the second thing".to_string();
        subtask2.kind = TaskKind::Subtask;
        subtask2.status = TaskStatus::Done;

        let subtasks = vec![subtask1, subtask2];
        let prompt = build_worker_prompt(&task, "# Agent", Some(&subtasks));

        assert!(prompt.contains("Subtasks Checklist"));
        assert!(prompt.contains("First subtask"));
        assert!(prompt.contains("Second subtask"));
        assert!(prompt.contains("[ ]")); // incomplete
        assert!(prompt.contains("[x]")); // complete
        assert!(prompt.contains("complete-subtask"));
    }
}
