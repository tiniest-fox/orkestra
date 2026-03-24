//! Human-triggered action interactions.
//!
//! Each interaction validates preconditions, executes the action,
//! and saves the result. Called by thin `WorkflowApi` dispatchers.

pub mod address_pr_conflicts;
pub mod address_pr_feedback;
pub mod answer_questions;
pub mod approve;
pub mod archive;
pub mod interrupt;
pub mod reject;
pub mod reject_with_comments;
pub mod request_update;
pub mod resume;
pub mod retry;
pub mod return_to_work;
pub mod send_to_stage;
pub mod set_auto_mode;
pub mod skip_stage;
