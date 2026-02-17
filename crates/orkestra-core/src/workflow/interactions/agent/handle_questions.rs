//! Handle questions output: store artifact, end iteration, auto-answer if `auto_mode`.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Question, QuestionAnswer, Task};
use crate::workflow::interactions::stage;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::{Artifact, Outcome, Phase};
use crate::workflow::services::IterationService;

/// Standard auto-answer text used when auto-mode tasks receive questions from agents.
pub const AUTO_ANSWER_TEXT: &str =
    "Make a decision based on your best understanding and highest recommendation.";

pub fn execute(
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    questions: &[Question],
    stage_name: &str,
    now: &str,
) -> WorkflowResult<()> {
    // Store questions as a markdown artifact for reference
    let artifact_name =
        stage::finalize_advancement::artifact_name_for_stage(workflow, stage_name, "artifact");
    let content = format_questions_as_markdown(questions);
    task.artifacts
        .set(Artifact::new(&artifact_name, &content, stage_name, now));

    stage::end_iteration::execute(
        iteration_service,
        task,
        Outcome::awaiting_answers(stage_name, questions.to_owned()),
    )?;

    if task.auto_mode {
        orkestra_debug!(
            "action",
            "auto-answering {} questions for auto_mode task {}",
            questions.len(),
            task.id
        );
        let answers = auto_answer_questions(questions);
        iteration_service.create_iteration(
            &task.id,
            stage_name,
            Some(IterationTrigger::Answers { answers }),
        )?;
        task.phase = Phase::Idle;
    } else {
        task.phase = Phase::AwaitingReview;
    }
    task.updated_at = now.to_string();
    Ok(())
}

// -- Helpers --

/// Format questions as a human-readable markdown artifact.
fn format_questions_as_markdown(questions: &[Question]) -> String {
    use std::fmt::Write;

    let mut md = String::from("# Questions\n");
    for (i, q) in questions.iter().enumerate() {
        write!(md, "\n## Question {}\n\n{}\n", i + 1, q.question).unwrap();
        if let Some(ctx) = &q.context {
            write!(md, "\n**Context:** {ctx}\n").unwrap();
        }
        if !q.options.is_empty() {
            md.push_str("\n**Options:**\n");
            for opt in &q.options {
                write!(md, "- {}", opt.label).unwrap();
                if let Some(desc) = &opt.description {
                    write!(md, " — {desc}").unwrap();
                }
                md.push('\n');
            }
        }
    }
    md
}

/// Generate auto-answers for all questions using a standard response.
fn auto_answer_questions(questions: &[Question]) -> Vec<QuestionAnswer> {
    let now = chrono::Utc::now().to_rfc3339();
    questions
        .iter()
        .map(|q| QuestionAnswer::new(&q.question, AUTO_ANSWER_TEXT, &now))
        .collect()
}
