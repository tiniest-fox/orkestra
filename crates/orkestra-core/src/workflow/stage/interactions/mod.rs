//! Stage transition logic: advancement, commit pipeline, recovery, session lifecycle.

pub mod advance_all_committed;
pub mod advance_parent;
pub mod auto_advance_or_review;
pub mod check_parent_completions;
pub mod collect_commit_jobs;
pub mod commit_failed;
pub mod commit_succeeded;
pub mod create_subtasks;
pub mod end_iteration;
pub mod enter_commit_pipeline;
pub mod execute_agent;
pub mod execute_rejection;
pub mod finalize_advancement;
pub mod materialize_artifacts;
pub mod pending_rejection_review;
pub mod poll_script;
pub mod recover_stale_commits;
pub mod session;
pub mod spawn_script;
