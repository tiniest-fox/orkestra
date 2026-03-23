//! CLI path discovery for agent process spawners.
//!
//! Finds the `ork` CLI binary and prepares the PATH environment variable
//! so spawned agent processes can locate it.
//!
//! In Tauri builds, call [`set_bundled_ork_path`] once at startup before any
//! agents are spawned. [`find_cli_path`] checks that path first; if absent, it
//! falls through to `which`/git/directory-walk strategies so non-Tauri builds
//! (daemon, CLI) work unchanged.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// Canonical bundled `ork` binary path, set once at Tauri app startup.
///
/// Using `OnceLock` avoids `std::env::set_var`, which is UB when other threads
/// exist (Tauri spawns internal threads before the setup closure runs).
static ORK_BIN_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Records the bundled `ork` binary path for use by [`find_cli_path`].
///
/// Call once during Tauri app startup (inside the `.setup()` closure) before
/// any agents are spawned. Subsequent calls are silently ignored — `OnceLock`
/// guarantees the value is written at most once.
pub fn set_bundled_ork_path(path: PathBuf) {
    let _ = ORK_BIN_PATH.set(path);
}

/// Finds the ork CLI binary path.
pub fn find_cli_path() -> Option<PathBuf> {
    find_cli_path_impl(ORK_BIN_PATH.get().and_then(|p| p.to_str()))
}

/// Inner implementation, accepting an explicit `ORK_BIN` override so callers
/// (including tests) can exercise the lookup without touching the process environment.
fn find_cli_path_impl(ork_bin_override: Option<&str>) -> Option<PathBuf> {
    // Check ORK_BIN override (injected by Tauri app at startup for bundled sidecar)
    if let Some(path) = ork_bin_override {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }

    // Check if ork is in PATH
    if let Ok(output) = Command::new("which")
        .arg("ork")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // Check relative to git repo root (for worktrees)
    if let Ok(output) = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    {
        if output.status.success() {
            let repo_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let git_root_path = PathBuf::from(repo_root).join("target/debug/ork");
            if git_root_path.exists() {
                return Some(git_root_path);
            }
        }
    }

    // Walk up the directory tree looking for target/debug/ork
    if let Ok(cwd) = std::env::current_dir() {
        let mut path = cwd.as_path();
        while let Some(parent) = path.parent() {
            let candidate = parent.join("target/debug/ork");
            if candidate.exists() {
                return Some(candidate);
            }
            path = parent;
        }
    }

    None
}

/// Prepends the `ork` CLI directory to the PATH entry in an environment map.
///
/// If `find_cli_path()` returns None, the map is unchanged.
pub fn prepend_cli_dir<S: std::hash::BuildHasher>(env: &mut HashMap<String, String, S>) {
    let cli_dir = find_cli_path().and_then(|p| p.parent().map(std::path::Path::to_path_buf));
    let Some(dir) = cli_dir else { return };
    let current_path = env.entry("PATH".to_string()).or_default();
    *current_path = format!("{}:{}", dir.display(), current_path);
}

/// Prepares the PATH environment variable with the CLI directory prepended.
pub fn prepare_path_env() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();
    match find_cli_path().and_then(|p| p.parent().map(std::path::Path::to_path_buf)) {
        Some(dir) => format!("{}:{}", dir.display(), current_path),
        None => current_path,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prepend_cli_dir() {
        let mut env = HashMap::new();
        let original = "/usr/bin:/bin".to_string();
        env.insert("PATH".to_string(), original.clone());
        prepend_cli_dir(&mut env);
        let path = &env["PATH"];
        // PATH should still contain original entries
        assert!(path.contains("/usr/bin"));
        // If CLI was found, PATH should be longer (something was prepended)
        if find_cli_path().is_some() {
            assert_ne!(path, &original, "CLI dir should have been prepended");
            assert!(
                path.ends_with(&original),
                "Original PATH should be at the end"
            );
        }
    }

    #[test]
    fn test_prepend_cli_dir_empty_env() {
        let mut env = HashMap::new();
        prepend_cli_dir(&mut env);
        // Should not panic; PATH may or may not be set depending on find_cli_path
        let _ = env.get("PATH");
    }

    #[test]
    fn ork_bin_existing_path_returned_first() {
        // A real file at the given path must be returned immediately, before any
        // fallback (which, git, directory walk).
        let dir = tempfile::tempdir().unwrap();
        let fake_ork = dir.path().join("ork");
        std::fs::File::create(&fake_ork).unwrap();

        let result = find_cli_path_impl(Some(fake_ork.to_str().unwrap()));
        assert_eq!(result, Some(fake_ork));
    }

    #[test]
    fn ork_bin_nonexistent_path_falls_through() {
        // A path that does not exist must fall through to the same strategies
        // as when no override is given at all.
        let with_bad_override =
            find_cli_path_impl(Some("/tmp/orkestra-test-nonexistent-ork-binary-xyz"));
        let without_override = find_cli_path_impl(None);
        assert_eq!(
            with_bad_override, without_override,
            "a non-existent override must fall through identically to no override"
        );
    }

    #[test]
    fn ork_bin_none_falls_through_to_other_strategies() {
        // When no override is provided the function continues to the other strategies.
        // We only verify it doesn't panic and doesn't return the override.
        let result = find_cli_path_impl(None);
        // Result may be Some (found via PATH/git/walk) or None — both are valid.
        // The important invariant: no panic and no UB.
        let _ = result;
    }

    #[test]
    fn ork_bin_empty_string_override_falls_through() {
        // An empty string is a valid (though degenerate) path that won't exist.
        let result = find_cli_path_impl(Some(""));
        assert_ne!(result.as_deref(), Some(std::path::Path::new("")));
    }
}
