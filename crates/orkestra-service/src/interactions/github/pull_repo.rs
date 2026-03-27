//! Pull the latest changes for an already-cloned repository.

use std::path::Path;

/// Attempt a fast-forward pull of the default remote branch.
///
/// Uses `git pull --ff-only` so local commits or uncommitted changes never
/// cause data loss — the pull is simply skipped and a warning is logged.
/// Returns `Ok(true)` if the pull succeeded, `Ok(false)` if it was skipped
/// (non-fast-forward, dirty tree, network error, etc.).
pub fn execute(repo_dir: &Path) -> bool {
    let result = std::process::Command::new("git")
        .args(["pull", "--ff-only"])
        .current_dir(repo_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    match result {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!(
                path = %repo_dir.display(),
                reason = %stderr.trim(),
                "git pull --ff-only skipped"
            );
            false
        }
        Err(e) => {
            tracing::warn!(
                path = %repo_dir.display(),
                error = %e,
                "git pull --ff-only failed to run"
            );
            false
        }
    }
}
