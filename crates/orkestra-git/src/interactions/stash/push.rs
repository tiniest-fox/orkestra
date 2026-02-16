//! Stash uncommitted changes in a working directory.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Stash uncommitted changes in a working directory.
///
/// Returns `true` if changes were stashed, `false` if there was nothing to stash.
pub fn execute(working_dir: &Path) -> Result<bool, GitError> {
    if !crate::interactions::commit::has_pending_changes::execute(working_dir)? {
        return Ok(false);
    }

    let output = Command::new("git")
        .args(["stash", "push", "-m", "orkestra-temp"])
        .current_dir(working_dir)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git stash: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::IoError(format!(
            "Failed to stash changes in {}: {stderr}",
            working_dir.display()
        )));
    }

    Ok(true)
}
