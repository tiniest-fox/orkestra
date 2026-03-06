//! Check whether the `gh` CLI is authenticated.

use crate::types::ServiceError;

/// Return `true` if `gh auth status` exits with code 0.
///
/// A non-zero exit code means the user is not logged in or `gh` is not
/// installed. Any error running the command is returned as `ServiceError`.
pub fn execute() -> Result<bool, ServiceError> {
    let status = std::process::Command::new("gh")
        .args(["auth", "status"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| ServiceError::Other(format!("Failed to run `gh auth status`: {e}")))?;

    Ok(status.success())
}
