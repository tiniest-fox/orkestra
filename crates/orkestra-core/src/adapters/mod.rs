//! Adapters for external systems.
//!
//! This module provides implementations of ports for external systems.
//! Currently only contains the SQLite database connection.

pub mod sqlite;

// Re-export DatabaseConnection for convenience
pub use sqlite::DatabaseConnection;
