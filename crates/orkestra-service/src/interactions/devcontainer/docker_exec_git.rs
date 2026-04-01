//! Run a git command inside a project container via `docker exec`.

use std::process::{Command, Stdio};

use crate::types::ServiceError;

/// Run `git -C <repo_path> <args...>` inside `container_id` as uid 1000.
///
/// Returns stdout on success. Returns `ServiceError::Other` with stderr on failure.
pub fn execute(
    container_id: &str,
    repo_path: &str,
    git_args: &[&str],
) -> Result<String, ServiceError> {
    let mut cmd = Command::new("docker");
    cmd.args(["exec", "-u", "1000", container_id, "git", "-C", repo_path]);
    cmd.args(git_args);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker exec git`: {e}")))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(ServiceError::Other(format!(
            "git {} failed in container {container_id}: {stderr}",
            git_args.join(" ")
        )))
    }
}
