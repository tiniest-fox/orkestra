//! Git integration interactions: merge, PR creation, commit, recovery.

pub mod begin_pr_creation;
pub mod build_diff_summary;
pub mod commit_and_push_pr_changes;
pub mod commit_worktree;
pub mod create_pull_request;
pub mod find_next_candidate;
pub mod generate_commit_message;
pub mod integration_failed;
pub mod integration_succeeded;
pub mod mark_integrating;
pub mod merge_task;
pub mod pr_creation_failed;
pub mod pr_creation_succeeded;
pub mod pull_pr_changes;
pub mod recover_stale;
pub mod retry_pr_creation;
pub mod squash_rebase_merge;
