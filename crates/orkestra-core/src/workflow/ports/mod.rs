//! Port interfaces for the workflow system.
//!
//! Ports define abstractions that allow the workflow system to work with
//! different implementations (databases, file systems, etc.) and enable testing.

mod crash_recovery;
mod process_spawner;
mod store;

pub use crash_recovery::CrashRecoveryStore;
pub use process_spawner::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};
pub use store::{WorkflowError, WorkflowResult, WorkflowStore};

#[cfg(any(test, feature = "testutil"))]
pub use crash_recovery::memory::InMemoryCrashRecoveryStore;
#[cfg(any(test, feature = "testutil"))]
pub use process_spawner::mock::MockProcessSpawner;
