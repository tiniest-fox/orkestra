//! Toggle the `auto_mode` flag on a task, with immediate side effects.

use crate::orkestra_debug;
use crate::workflow::agent::interactions::handle_questions::AUTO_ANSWER_TEXT;
use crate::workflow::domain::{IterationTrigger, QuestionAnswer, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

#[allow(clippy::too_many_lines)]
pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    auto_mode: bool,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    orkestra_debug!(
        "action",
        "set_auto_mode {}: {} -> {}",
        task_id,
        task.auto_mode,
        auto_mode
    );

    task.auto_mode = auto_mode;

    // When enabling auto mode, handle immediate side effects
    if auto_mode && task.is_awaiting_review() {
        if let Some(current_stage) = task.current_stage().map(String::from) {
            // Check if there are pending questions
            let has_pending_questions = store
                .get_latest_iteration(&task.id, &current_stage)?
                .and_then(|iter| match &iter.outcome {
                    Some(Outcome::AwaitingAnswers { questions, .. }) if !questions.is_empty() => {
                        Some(questions.clone())
                    }
                    _ => None,
                });

            if let Some(questions) = has_pending_questions {
                // Auto-answer questions
                orkestra_debug!(
                    "action",
                    "set_auto_mode {}: auto-answering {} questions",
                    task_id,
                    questions.len()
                );
                let now = chrono::Utc::now().to_rfc3339();
                let answers: Vec<QuestionAnswer> = questions
                    .iter()
                    .map(|q| QuestionAnswer::new(&q.question, AUTO_ANSWER_TEXT, &now))
                    .collect();

                iteration_service.create_iteration(
                    &task.id,
                    &current_stage,
                    Some(IterationTrigger::Answers { answers }),
                )?;
                task.state = TaskState::queued(&current_stage);
                task.updated_at = now;
            } else if let Some((from_stage, target, feedback)) =
                stage::pending_rejection_review::execute(store, &task.id, &current_stage)?
            {
                // Auto-confirm pending rejection
                orkestra_debug!(
                    "action",
                    "set_auto_mode {}: auto-confirming rejection from {} to {}",
                    task_id,
                    from_stage,
                    target
                );
                let now = chrono::Utc::now().to_rfc3339();
                stage::execute_rejection::execute(
                    iteration_service,
                    &mut task,
                    &from_stage,
                    &target,
                    &feedback,
                    &now,
                )?;
            } else {
                // Auto-approve stage and enter commit pipeline
                orkestra_debug!(
                    "action",
                    "set_auto_mode {}: auto-approving stage {}",
                    task.id,
                    current_stage
                );
                let now = chrono::Utc::now().to_rfc3339();
                stage::enter_commit_pipeline::execute(iteration_service, &mut task, &now)?;
            }
        }
    } else {
        task.updated_at = chrono::Utc::now().to_rfc3339();
    }

    store.save_task(&task)?;
    Ok(task)
}
