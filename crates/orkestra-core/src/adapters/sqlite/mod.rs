//! SQLite database connection and migrations.
//!
//! This module provides:
//! - `DatabaseConnection` - Shared connection wrapper with migration support

mod connection;
pub mod migrations;

pub use connection::DatabaseConnection;
