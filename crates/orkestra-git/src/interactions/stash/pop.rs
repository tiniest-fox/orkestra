//! Restore stashed changes in a working directory.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Restore stashed changes in a working directory.
///
/// Only pops if we actually stashed something (indicated by `was_stashed`).
pub fn execute(working_dir: &Path, was_stashed: bool) -> Result<(), GitError> {
    if !was_stashed {
        return Ok(());
    }

    let output = Command::new("git")
        .args(["stash", "pop"])
        .current_dir(working_dir)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git stash pop: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("No stash entries found") {
            return Err(GitError::IoError(format!(
                "Failed to restore stashed changes in {}: {stderr}",
                working_dir.display()
            )));
        }
    }

    Ok(())
}
