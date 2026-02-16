//! SQLite database connection and migrations.
//!
//! Re-exports from `orkestra-store`.

pub use orkestra_store::DatabaseConnection;

/// Migrations re-exported for external access.
pub mod migrations {
    pub use orkestra_store::migrations::run;
}
