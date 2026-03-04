//! CLI path discovery for agent process spawners.
//!
//! Finds the `ork` CLI binary and prepares the PATH environment variable
//! so spawned agent processes can locate it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

/// Finds the ork CLI binary path.
pub fn find_cli_path() -> Option<PathBuf> {
    // First check if ork is in PATH
    if let Ok(output) = Command::new("which").arg("ork").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // Check relative to current directory (development mode)
    let dev_path = std::env::current_dir().ok()?.join("target/debug/ork");
    if dev_path.exists() {
        return Some(dev_path);
    }

    // Check relative to git repo root (for worktrees)
    if let Ok(output) = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
    {
        if output.status.success() {
            let repo_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let git_root_path = PathBuf::from(&repo_root).join("target/debug/ork");
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
}
