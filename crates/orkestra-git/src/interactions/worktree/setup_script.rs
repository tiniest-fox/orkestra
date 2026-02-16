//! Run the worktree setup script.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Run the worktree setup script if it exists.
///
/// Looks for `.orkestra/scripts/worktree_setup.sh` in the main repo and runs it
/// with the worktree path as an argument.
pub fn execute(repo_path: &Path, worktree_path: &Path) -> Result<(), GitError> {
    let setup_script = repo_path.join(".orkestra/scripts/worktree_setup.sh");

    if !setup_script.exists() {
        return Ok(());
    }

    let output = Command::new("bash")
        .arg(&setup_script)
        .arg(worktree_path)
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::WorktreeError(format!("Setup script failed to run: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let error_output = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!("exit code {}", output.status.code().unwrap_or(-1))
        };
        return Err(GitError::WorktreeError(format!(
            "Setup script failed: {error_output}"
        )));
    }

    Ok(())
}
