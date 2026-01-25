//! Port interfaces for the workflow system.
//!
//! Ports define abstractions that allow the workflow system to work with
//! different implementations (databases, file systems, etc.) and enable testing.

mod store;

pub use store::{WorkflowError, WorkflowResult, WorkflowStore};
