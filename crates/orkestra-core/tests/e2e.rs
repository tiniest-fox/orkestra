//! End-to-end tests for orkestra-core.
//!
//! Run all:           `cargo test --test e2e`
//! Run by module:     `cargo test --test e2e cleanup`
//! Run specific test: `cargo test --test e2e test_exhaustive_workflow_flow`

#[path = "e2e/helpers.rs"]
mod helpers;

#[path = "e2e/cleanup.rs"]
mod cleanup;
#[path = "e2e/startup.rs"]
mod startup;
#[path = "e2e/subtasks.rs"]
mod subtasks;
#[path = "e2e/task_creation.rs"]
mod task_creation;
#[path = "e2e/workflow.rs"]
mod workflow;
