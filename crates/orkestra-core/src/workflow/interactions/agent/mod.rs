//! Agent output processing interactions.
//!
//! Handles all agent/script output: artifacts, questions, subtasks,
//! approvals, failures, and script results.

pub mod agent_started;
pub mod fail_execution;
pub mod handle_approval;
pub mod handle_artifact;
pub mod handle_questions;
pub mod handle_subtasks;
pub mod process_output;
pub mod process_script_failure;
pub mod process_script_success;
