//! Git integration interactions: merge, PR creation, success/failure handling.

pub mod begin_pr_creation;
pub mod integration_failed;
pub mod integration_succeeded;
pub mod mark_integrating;
pub mod merge_task;
pub mod pr_creation_failed;
pub mod pr_creation_succeeded;
pub mod retry_pr_creation;
