//! Agent execution crate for Orkestra.
//!
//! Owns agent spawning, output streaming, result parsing, script execution,
//! provider resolution, and `ProcessSpawner` implementations.

pub mod interactions;
mod interface;
pub mod registry;
mod script_handle;
mod service;
mod types;

#[cfg(any(test, feature = "testutil"))]
mod mock;

use std::collections::HashMap;
use std::path::Path;

// Re-export the unified debug macro for use within this crate
pub(crate) use orkestra_debug::orkestra_debug;

// -- Public API --

// Trait
pub use interface::AgentRunner;

// Service
pub use service::ProcessAgentRunner;

// Types
pub use types::{AgentCompletionError, RunConfig, RunError, RunEvent, RunResult};

// Script
pub use script_handle::{ScriptEnv, ScriptHandle, ScriptPollState, ScriptResult};

// Env resolution
pub use interactions::env::resolve_project_env::execute as resolve_project_env;
pub use interactions::spawner::cli_path::{prepend_cli_dir, set_bundled_ork_path};

/// Resolve the full agent environment for a project.
///
/// Runs the login shell in the project root to capture the environment,
/// then prepends the ork CLI directory to PATH. Returns `None` if shell
/// is `None` or resolution fails (callers fall back to inherited env).
pub fn resolve_agent_env(
    project_root: &Path,
    shell: Option<&str>,
) -> Option<HashMap<String, String>> {
    let shell = shell?;
    let mut env = resolve_project_env(project_root, shell)?;
    prepend_cli_dir(&mut env);
    Some(env)
}

// Registry
pub use registry::{
    claudecode_aliases, claudecode_capabilities, opencode_aliases, opencode_capabilities,
    ProviderCapabilities, ProviderRegistry, RegistryError, ResolvedProvider,
};

// Mock (feature-gated)
#[cfg(any(test, feature = "testutil"))]
pub use mock::MockAgentRunner;
#[cfg(any(test, feature = "testutil"))]
pub use registry::default_test_registry;
