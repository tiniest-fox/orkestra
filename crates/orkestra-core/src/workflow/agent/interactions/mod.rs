//! Agent execution interactions: output processing, completion dispatch.

pub mod agent_started;
pub mod auto_retry_malformed;
pub mod dispatch_completion;
pub mod fail_execution;
pub mod handle_approval;
pub mod handle_artifact;
pub mod handle_questions;
pub mod handle_subtasks;
pub mod process_gate_failure;
pub mod process_gate_success;
pub mod process_output;
