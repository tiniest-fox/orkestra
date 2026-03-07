//! Clone a GitHub repository to a local directory.

use std::path::Path;

use crate::types::ServiceError;

/// Clone `repo_url` into `target_dir` using `git clone`.
///
/// Creates the parent directory if it does not exist. Returns an error with
/// `stderr` output if the clone fails or `git` is not found on PATH.
pub fn execute(repo_url: &str, target_dir: &Path) -> Result<(), ServiceError> {
    if let Some(parent) = target_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let output = std::process::Command::new("git")
        .args(["clone", repo_url])
        .arg(target_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `git clone`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!("`git clone` failed: {stderr}")));
    }

    Ok(())
}
