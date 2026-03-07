//! Copy the `orkd` binary into a running container via `docker cp`.

use std::path::Path;
use std::process::Command;

use crate::types::ServiceError;

/// Copy `orkd_path` into `container_id` at `/usr/local/bin/orkd` and make it executable.
///
/// `docker cp` reads `orkd_path` from the local filesystem — when running
/// inside the service container (`DooD` setup) this resolves to the service
/// container's own filesystem, where `orkd` lives. The project container
/// therefore receives a real binary rather than an empty bind-mount directory.
pub fn execute(container_id: &str, orkd_path: &Path) -> Result<(), ServiceError> {
    let dest = format!("{container_id}:/usr/local/bin/orkd");

    // docker cp <host_src> <container>:<dest>
    let output = Command::new("docker")
        .args(["cp"])
        .arg(orkd_path)
        .arg(&dest)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker cp`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!("`docker cp` failed: {stderr}")));
    }

    // Ensure the binary is executable inside the container.
    let chmod = Command::new("docker")
        .args(["exec", container_id, "chmod", "+x", "/usr/local/bin/orkd"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker exec chmod`: {e}")))?;

    if !chmod.status.success() {
        let stderr = String::from_utf8_lossy(&chmod.stderr);
        return Err(ServiceError::Other(format!(
            "`docker exec chmod +x orkd` failed: {stderr}"
        )));
    }

    Ok(())
}
