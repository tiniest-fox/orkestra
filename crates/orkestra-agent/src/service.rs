//! Production agent runner implementation.
//!
//! `ProcessAgentRunner` delegates to interactions for sync and async execution.
//! When a `HookServer` is attached via `with_hook_server`, the `claude-pty`
//! provider is routed to `run_pty::execute()` instead of the standard path.

use std::sync::mpsc::Receiver;
use std::sync::Arc;

use crate::interactions::hooks::types::HookServer;
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
    hook_server: Option<Arc<HookServer>>,
}

impl ProcessAgentRunner {
    /// Create a new agent runner with the given provider registry.
    pub fn new(registry: Arc<ProviderRegistry>) -> Self {
        Self {
            registry,
            hook_server: None,
        }
    }

    /// Attach a hook server, enabling the `claude-pty` provider path.
    ///
    /// Required when any registered provider uses `claude-pty`. Without a hook
    /// server, `run_async` returns `SpawnFailed` for PTY provider runs.
    #[must_use]
    pub fn with_hook_server(mut self, server: Arc<HookServer>) -> Self {
        self.hook_server = Some(server);
        self
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
            hook_server: None,
        }
    }
}

impl AgentRunner for ProcessAgentRunner {
    fn run_sync(&self, config: RunConfig) -> Result<RunResult, RunError> {
        crate::interactions::agent::run_sync::execute(&self.registry, config)
    }

    fn run_async(&self, config: RunConfig) -> Result<(u32, Receiver<RunEvent>), RunError> {
        let resolved = self
            .registry
            .resolve(config.model.as_deref())
            .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

        if resolved.provider_name == "claude-pty" {
            let hook_server = self.hook_server.as_ref().ok_or_else(|| {
                RunError::SpawnFailed("claude-pty provider requires a hook server".into())
            })?;
            crate::interactions::agent::run_pty::execute(&self.registry, &config, hook_server)
        } else {
            crate::interactions::agent::run_async::execute(&self.registry, config)
        }
    }
}
