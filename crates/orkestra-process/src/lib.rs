//! Process management infrastructure for Orkestra.
//!
//! Provides process lifecycle utilities: RAII guards, tree killing,
//! liveness checks, stderr collection, and stream event parsing.
//! Also defines the `ProcessSpawner` trait for agent process backends.

mod interface;
mod types;

mod interactions;

#[cfg(any(test, feature = "testutil"))]
mod mock;

// Trait
pub use interface::ProcessSpawner;

// Types
pub use types::{ParsedStreamEvent, ProcessConfig, ProcessError, ProcessGuard, ProcessHandle};

// Interactions (re-exported with natural names)
pub use interactions::io::spawn_stderr_reader::execute as spawn_stderr_reader;
pub use interactions::stream::parse_event::execute as parse_stream_event;
pub use interactions::tree::is_running::execute as is_process_running;
pub use interactions::tree::is_running::is_zombie;
pub use interactions::tree::kill::execute as kill_process_tree;

// Mock (feature-gated)
#[cfg(any(test, feature = "testutil"))]
pub use mock::{MockProcessSpawner, SpawnCall};
