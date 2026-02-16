//! Production agent runner implementation.
//!
//! `ProcessAgentRunner` delegates to interactions for sync and async execution.

use std::sync::mpsc::Receiver;
use std::sync::Arc;

use crate::interface::AgentRunner;
use crate::registry::ProviderRegistry;
use crate::types::{RunConfig, RunError, RunEvent, RunResult};

// ============================================================================
// ProcessAgentRunner
// ============================================================================

/// Runs agents to completion using the provider registry.
///
/// The runner is responsible for:
/// - Resolving the provider from the model spec via `ProviderRegistry`
/// - Creating a provider-specific `AgentParser` via `ProviderRegistry::create_parser`
/// - Spawning the process via the resolved provider's `ProcessSpawner`
/// - Writing the prompt to stdin
/// - Reading and parsing output through the `AgentParser`
///
/// The runner is NOT responsible for:
/// - Building prompts (receives them)
/// - Managing sessions (returns `session_id`)
/// - Task state updates (caller handles)
pub struct ProcessAgentRunner {
    registry: Arc<ProviderRegistry>,
}

impl ProcessAgentRunner {
    /// Create a new agent runner with the given provider registry.
    pub fn new(registry: Arc<ProviderRegistry>) -> Self {
        Self { registry }
    }

    /// Create a new agent runner with a single process spawner (backward compat).
    ///
    /// Wraps the spawner in a registry as the default "claudecode" provider.
    pub fn new_with_single_spawner(spawner: Arc<dyn orkestra_process::ProcessSpawner>) -> Self {
        use crate::registry::{claudecode_aliases, claudecode_capabilities};
        let mut registry = ProviderRegistry::new("claudecode");
        registry.register(
            "claudecode",
            spawner,
            claudecode_capabilities(),
            claudecode_aliases(),
        );
        Self {
            registry: Arc::new(registry),
        }
    }
}

impl AgentRunner for ProcessAgentRunner {
    fn run_sync(&self, config: RunConfig) -> Result<RunResult, RunError> {
        crate::interactions::agent::run_sync::execute(&self.registry, config)
    }

    fn run_async(&self, config: RunConfig) -> Result<(u32, Receiver<RunEvent>), RunError> {
        crate::interactions::agent::run_async::execute(&self.registry, config)
    }
}
