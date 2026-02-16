//! CLI path discovery for agent process spawners.
//!
//! Finds the `ork` CLI binary and prepares the PATH environment variable
//! so spawned agent processes can locate it.

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

/// Prepares the PATH environment variable with the CLI directory.
pub fn prepare_path_env() -> String {
    let cli_path = find_cli_path();
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(ref cli) = cli_path {
        if let Some(parent) = cli.parent() {
            path_env = format!("{}:{}", parent.display(), path_env);
        }
    }
    path_env
}
