//! End-to-end tests for orkestra-core.
//!
//! Run all:           `cargo test --test e2e`
//! Run by module:     `cargo test --test e2e cleanup`
//! Run specific test: `cargo test --test e2e test_exhaustive_workflow_flow`
//!
//! Real-agent tests (require CLI tools + API keys):
//!   `cargo test --test e2e opencode -- --ignored --nocapture`
//!   `cargo test --test e2e claudecode -- --ignored --nocapture`

#[path = "e2e/helpers.rs"]
mod helpers;

#[path = "e2e/artifact_history.rs"]
mod artifact_history;

#[path = "e2e/assistant.rs"]
mod assistant;
#[path = "e2e/cleanup.rs"]
mod cleanup;
#[path = "e2e/differential.rs"]
mod differential;
#[path = "e2e/git_sync.rs"]
mod git_sync;
#[path = "e2e/integration.rs"]
mod integration;
#[path = "e2e/interactive.rs"]
mod interactive;
#[path = "e2e/lock.rs"]
mod lock;
#[path = "e2e/multi_project.rs"]
mod multi_project;
#[path = "e2e/play.rs"]
mod play;
#[path = "e2e/pr_description_audit.rs"]
mod pr_description_audit;
#[path = "e2e/resources.rs"]
mod resources;
#[path = "e2e/squash_commits.rs"]
mod squash_commits;
#[path = "e2e/stage_chat.rs"]
mod stage_chat;
#[path = "e2e/startup.rs"]
mod startup;
#[path = "e2e/subtasks.rs"]
mod subtasks;
#[path = "e2e/sync.rs"]
mod sync;
#[path = "e2e/task_creation.rs"]
mod task_creation;
#[path = "e2e/workflow.rs"]
mod workflow;

// Real-agent tests (no mocks — require actual CLI tools + API keys)
#[path = "e2e/agents/helpers.rs"]
mod agent_helpers;
#[path = "e2e/agents/claudecode.rs"]
mod claudecode;
#[path = "e2e/agents/opencode.rs"]
mod opencode;
