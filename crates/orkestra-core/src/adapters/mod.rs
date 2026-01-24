mod claude_spawner;
mod sqlite_store;
mod system_clock;

// New modular sqlite implementation
pub mod sqlite;

pub use claude_spawner::ClaudeSpawner;
// Re-export old SqliteStore for now during migration
pub use sqlite_store::SqliteStore;
pub use system_clock::{FixedClock, SystemClock};

// Re-export new types from sqlite module
pub use sqlite::{
    DatabaseConnection, IterationRepository, StageSessionRepository, TaskRepository,
    WorkLoopRepository,
};
