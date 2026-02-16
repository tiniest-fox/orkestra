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

// -- Debug macro --

/// Debug logging macro for orkestra-agent.
///
/// Checks `ORKESTRA_DEBUG=1` env var and writes to stderr. Replaces the
/// `orkestra_debug!` macro from orkestra-core for use within this crate.
macro_rules! agent_debug {
    ($component:expr, $($arg:tt)*) => {
        if std::env::var("ORKESTRA_DEBUG").is_ok() {
            eprintln!("[orkestra:{}] {}", $component, format!($($arg)*));
        }
    };
}
pub(crate) use agent_debug;

// -- Public API --

// Trait
pub use interface::AgentRunner;

// Service
pub use service::ProcessAgentRunner;

// Types
pub use types::{RunConfig, RunError, RunEvent, RunResult};

// Script
pub use script_handle::{ScriptEnv, ScriptHandle, ScriptPollState, ScriptResult};

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
