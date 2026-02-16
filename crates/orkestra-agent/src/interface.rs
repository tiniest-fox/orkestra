//! Agent runner trait definition.

use std::sync::mpsc::Receiver;

use crate::types::{RunConfig, RunError, RunEvent, RunResult};

/// Trait for running agents.
///
/// This abstraction allows for both real process execution and mock testing.
pub trait AgentRunner: Send + Sync {
    /// Run an agent synchronously (blocking).
    fn run_sync(&self, config: RunConfig) -> Result<RunResult, RunError>;

    /// Run an agent asynchronously with events.
    fn run_async(&self, config: RunConfig) -> Result<(u32, Receiver<RunEvent>), RunError>;
}
