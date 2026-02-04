//! Re-exports for project state management.
//!
//! This module previously contained `AppState`. It now re-exports types from
//! `project_registry` for backward compatibility during the migration.

pub use crate::project_registry::{project_for_window, ProjectRegistry};
