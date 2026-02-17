//! Human-triggered action interactions.
//!
//! Each interaction validates preconditions, executes the action,
//! and saves the result. Called by thin `WorkflowApi` dispatchers.

pub mod address_pr_comments;
pub mod address_pr_conflicts;
pub mod answer_questions;
pub mod approve;
pub mod archive;
pub mod interrupt;
pub mod reject;
pub mod resume;
pub mod retry;
pub mod set_auto_mode;
