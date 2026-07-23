//! Stage domain — execution, session management, commit pipeline, and stage transitions.

pub(crate) mod agents;
pub mod interactions;
pub(crate) mod scripts;
pub(crate) mod service;
pub(crate) mod session;
pub mod types;

pub use types::{deduplicate_activity_logs_by_stage, ActivityLogEntry};
