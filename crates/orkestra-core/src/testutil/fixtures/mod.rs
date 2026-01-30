//! Composable test fixtures organized by domain type.
//!
//! Each sub-module provides factory functions that create and persist
//! domain objects through a `WorkflowStore`. Tests compose them freely:
//!
//! ```ignore
//! use orkestra_core::testutil::fixtures::{tasks, sessions, iterations};
//!
//! let task = tasks::save_planning_task(&store, "t1")?;
//! let sess = sessions::save_session(&store, "s1", "t1", "planning")?;
//! let iter = iterations::save_iteration(&store, "i1", "t1", "planning", 1, "s1")?;
//! ```

pub mod iterations;
pub mod sessions;
pub mod tasks;

/// Deterministic timestamp for test fixtures.
pub const FIXTURE_TIMESTAMP: &str = "2025-01-24T10:00:00Z";
