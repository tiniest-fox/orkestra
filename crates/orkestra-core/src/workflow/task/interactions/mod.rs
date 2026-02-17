//! Task interactions: CRUD, setup, recovery.

pub mod cleanup_orphaned_worktrees;
pub mod create;
pub mod create_subtask;
pub mod delete;
pub mod find_spawn_candidates;
pub mod list;
pub mod recover_stale_agents;
pub mod recover_stale_setup;
pub mod setup_awaiting;
