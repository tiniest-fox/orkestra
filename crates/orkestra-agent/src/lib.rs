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
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

// Re-export the unified debug macro for use within this crate
pub(crate) use orkestra_debug::orkestra_debug;

// -- Public API --

// Trait
pub use interface::AgentRunner;

// Service
pub use service::ProcessAgentRunner;

// Types
pub use types::{RunConfig, RunError, RunEvent, RunResult};

// Script
pub use script_handle::{ScriptEnv, ScriptHandle, ScriptPollState, ScriptResult};

// Env resolution
pub use interactions::env::resolve_mise_env::execute as resolve_mise_env;
pub use interactions::env::resolve_project_env::execute as resolve_project_env;
pub use interactions::spawner::cli_path::{prepend_cli_dir, set_bundled_ork_path};

// ============================================================================
// Cached Environment Resolution
// ============================================================================

/// How long a cached environment remains valid before re-resolving.
const ENV_CACHE_TTL_SECS: u64 = 300; // 5 minutes

/// Cached environment entry.
struct CachedEnv {
    project_root: PathBuf,
    env: HashMap<String, String>,
    resolved_at: Instant,
}

/// Global cache for resolved project environments.
///
/// Avoids re-running mise/shell on every agent spawn (each spawn was blocking
/// for 100ms-5s). The cache is keyed on `project_root` and expires after 5 minutes.
static ENV_CACHE: Mutex<Option<CachedEnv>> = Mutex::new(None);

/// Resolve the full agent environment for a project.
///
/// Tries mise first (fast, ~120ms, works from bare launchd env), falls back
/// to the login shell approach if mise is not installed. Results are cached
/// for 5 minutes to avoid re-resolving on every agent spawn.
///
/// Returns `None` if both approaches fail (callers fall back to inherited env).
///
/// **mise vs shell:** The login shell approach (`zsh -l -i -c 'env -0'`) returns
/// the complete environment (40+ vars), so the spawner can safely `env_clear()`
/// and use it as a full replacement. The mise approach returns only the delta
/// (3-5 vars like PATH, `RUBY_ROOT`), so we merge it on top of the inherited
/// process environment to produce a complete env map.
pub fn resolve_agent_env(
    project_root: &Path,
    shell: Option<&str>,
) -> Option<HashMap<String, String>> {
    // Check cache first
    if let Some(cached) = get_cached_env(project_root) {
        orkestra_debug!("env", "Using cached env for {}", project_root.display());
        return Some(cached);
    }

    // Try mise first (fast path: ~120ms, no shell init).
    // mise returns only the delta vars it manages, so we merge them on top
    // of the inherited process env to produce a complete environment.
    let env = if let Some(mise_overlay) = resolve_mise_env(project_root) {
        let var_count = mise_overlay.len();
        let mut full_env: HashMap<String, String> = std::env::vars().collect();
        full_env.extend(mise_overlay);
        orkestra_debug!(
            "env",
            "Merged {} mise vars into {} inherited vars",
            var_count,
            full_env.len()
        );
        Some(full_env)
    } else {
        // Fall back to login shell (slow path: ~1-5s).
        // The shell returns a complete environment, no merging needed.
        let shell = shell?;
        orkestra_debug!(
            "env",
            "mise not available, falling back to shell env resolution"
        );
        resolve_project_env(project_root, shell)
    };

    let mut env = env?;
    prepend_cli_dir(&mut env);

    // Cache the result
    set_cached_env(project_root, &env);

    Some(env)
}

/// Invalidate the cached env, forcing the next call to re-resolve.
pub fn invalidate_env_cache() {
    if let Ok(mut cache) = ENV_CACHE.lock() {
        *cache = None;
    }
}

// -- Cache Helpers --

fn get_cached_env(project_root: &Path) -> Option<HashMap<String, String>> {
    let cache = ENV_CACHE.lock().ok()?;
    let entry = cache.as_ref()?;

    if entry.project_root != project_root {
        return None;
    }

    if entry.resolved_at.elapsed().as_secs() >= ENV_CACHE_TTL_SECS {
        return None;
    }

    Some(entry.env.clone())
}

fn set_cached_env(project_root: &Path, env: &HashMap<String, String>) {
    if let Ok(mut cache) = ENV_CACHE.lock() {
        *cache = Some(CachedEnv {
            project_root: project_root.to_path_buf(),
            env: env.clone(),
            resolved_at: Instant::now(),
        });
    }
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
