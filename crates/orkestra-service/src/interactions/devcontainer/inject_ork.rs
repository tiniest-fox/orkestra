//! Copy the `ork` binary into a running container via `docker cp`.

use std::path::Path;
use std::process::Command;

use crate::types::ServiceError;

/// Copy `ork_path` into `container_id` at `/usr/local/bin/ork` and make it executable.
///
/// `docker cp` reads `ork_path` from the local filesystem — when running
/// inside the service container (`DooD` setup) this resolves to the service
/// container's own filesystem, where `ork` lives. The project container
/// therefore receives a real binary rather than an empty bind-mount directory.
pub fn execute(container_id: &str, ork_path: &Path) -> Result<(), ServiceError> {
    let dest = format!("{container_id}:/usr/local/bin/ork");

    // docker cp <host_src> <container>:<dest>
    let output = Command::new("docker")
        .args(["cp"])
        .arg(ork_path)
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
        .args(["exec", container_id, "chmod", "+x", "/usr/local/bin/ork"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker exec chmod`: {e}")))?;

    if !chmod.status.success() {
        let stderr = String::from_utf8_lossy(&chmod.stderr);
        return Err(ServiceError::Other(format!(
            "`docker exec chmod +x ork` failed: {stderr}"
        )));
    }

    Ok(())
}
