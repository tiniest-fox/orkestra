//! Shared stage transition logic.
//!
//! Cross-cutting operations used by agent, human, and integration actions.

pub mod advance_parent;
pub mod auto_advance_or_review;
pub mod commit_failed;
pub mod commit_succeeded;
pub mod create_subtasks;
pub mod end_iteration;
pub mod enter_commit_pipeline;
pub mod execute_rejection;
pub mod finalize_advancement;
pub mod pending_rejection_review;
