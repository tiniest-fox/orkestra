//! Individual git operations, grouped by domain.
//!
//! Every interaction has a single `execute()` entry point.

pub mod branch;
pub mod commit;
pub mod diff;
pub mod file;
pub mod merge;
pub mod remote;
pub mod stash;
pub mod worktree;
