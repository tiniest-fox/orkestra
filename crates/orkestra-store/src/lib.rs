//! Workflow persistence layer for the Orkestra system.
//!
//! Provides the `WorkflowStore` trait and implementations for SQLite and
//! in-memory storage backends.

mod connection;
mod interface;
pub mod interactions;
pub mod migrations;
mod service;
mod types;

pub use connection::DatabaseConnection;
pub use interface::{WorkflowError, WorkflowResult, WorkflowStore};
pub use service::SqliteWorkflowStore;

#[cfg(any(test, feature = "testutil"))]
mod mock;
#[cfg(any(test, feature = "testutil"))]
pub use mock::InMemoryWorkflowStore;
