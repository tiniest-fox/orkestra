//! Iteration fixture factories.

use crate::workflow::domain::Iteration;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Outcome;

use super::FIXTURE_TIMESTAMP;

/// Save an active iteration linked to a session.
pub fn save_iteration(
    store: &dyn WorkflowStore,
    id: &str,
    task_id: &str,
    stage: &str,
    number: u32,
    session_id: &str,
) -> WorkflowResult<Iteration> {
    let iteration = Iteration::new(id, task_id, stage, number, FIXTURE_TIMESTAMP)
        .with_stage_session_id(session_id);
    store.save_iteration(&iteration)?;
    Ok(iteration)
}

/// Save a completed iteration with Approved outcome.
pub fn save_approved_iteration(
    store: &dyn WorkflowStore,
    id: &str,
    task_id: &str,
    stage: &str,
    number: u32,
    session_id: &str,
) -> WorkflowResult<Iteration> {
    let mut iteration = Iteration::new(id, task_id, stage, number, FIXTURE_TIMESTAMP)
        .with_stage_session_id(session_id);
    iteration.end(FIXTURE_TIMESTAMP, Outcome::Approved);
    store.save_iteration(&iteration)?;
    Ok(iteration)
}

/// Save a completed iteration with Rejected outcome and feedback.
pub fn save_rejected_iteration(
    store: &dyn WorkflowStore,
    id: &str,
    task_id: &str,
    stage: &str,
    number: u32,
    session_id: &str,
    feedback: &str,
) -> WorkflowResult<Iteration> {
    let mut iteration = Iteration::new(id, task_id, stage, number, FIXTURE_TIMESTAMP)
        .with_stage_session_id(session_id);
    iteration.end(FIXTURE_TIMESTAMP, Outcome::rejected(stage, feedback));
    store.save_iteration(&iteration)?;
    Ok(iteration)
}
