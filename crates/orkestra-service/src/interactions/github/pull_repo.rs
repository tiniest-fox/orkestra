//! Pull the latest changes for an already-cloned repository.

use std::path::Path;

/// Attempt a rebase pull of the default remote branch.
///
/// Uses `git pull --rebase` so local commits (e.g. Orkestra task commits) are
/// replayed on top of the fetched upstream. If the rebase fails due to
/// conflicts or a dirty tree, the pull is skipped and a warning is logged.
/// Returns `true` if the pull succeeded, `false` if it was skipped.
pub fn execute(repo_dir: &Path) -> bool {
    let safe_dir = format!("safe.directory={}", repo_dir.display());

    // Prune stale worktree entries before pulling. Orkestra's task worktrees
    // reference paths inside containers (/workspace/...) which don't exist on
    // the host, causing git to reject the pull with "Invalid path" errors.
    let _ = std::process::Command::new("git")
        .args(["-c", &safe_dir, "worktree", "prune"])
        .current_dir(repo_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output();

    let result = std::process::Command::new("git")
        .args(["-c", &safe_dir, "pull", "--rebase"])
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
                "git pull --rebase skipped"
            );
            false
        }
        Err(e) => {
            tracing::warn!(
                path = %repo_dir.display(),
                error = %e,
                "git pull --rebase failed to run"
            );
            false
        }
    }
}
