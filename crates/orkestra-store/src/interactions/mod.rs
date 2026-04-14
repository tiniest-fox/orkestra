//! Store interactions organized by domain.
//!
//! Each subdirectory groups operations for a single entity type.
//! Each file contains one `execute()` entry point.

pub mod artifact;
pub mod assistant;
pub mod daemon_config;
pub mod iteration;
pub mod log_entry;
pub mod session;
pub mod task;
