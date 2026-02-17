//! Answer pending questions from the agent.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, QuestionAnswer, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, Phase};
use crate::workflow::services::IterationService;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    answers: Vec<QuestionAnswer>,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    // Get questions from latest iteration's outcome
    let prev_iter = store
        .get_latest_iteration(&task.id, &current_stage)?
        .ok_or_else(|| WorkflowError::InvalidTransition("No iteration to answer".into()))?;

    // Verify there are pending questions in the outcome
    let _questions = match &prev_iter.outcome {
        Some(Outcome::AwaitingAnswers { questions, .. }) if !questions.is_empty() => questions,
        _ => {
            return Err(WorkflowError::InvalidTransition(
                "No pending questions to answer".into(),
            ))
        }
    };

    orkestra_debug!(
        "action",
        "answer_questions {}: {} answers provided",
        task_id,
        answers.len()
    );

    let now = chrono::Utc::now().to_rfc3339();

    // Create new iteration with Answers context
    iteration_service.create_iteration(
        &task.id,
        &current_stage,
        Some(IterationTrigger::Answers { answers }),
    )?;

    // Task stays in same stage, phase goes back to Idle so agent can resume
    task.phase = Phase::Idle;
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}
