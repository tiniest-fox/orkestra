//! Connect a project container to the service container's Docker networks.

use std::process::{Command, Stdio};

use crate::types::ServiceError;

/// Connect `container_id` to every user-defined Docker network the service
/// container is on.
///
/// In `DooD` setups the service and project containers run as siblings on the
/// host Docker daemon. Joining a shared user-defined network lets the service
/// reach the project daemon by container name via Docker's embedded DNS.
///
/// This is a no-op when the service is not running inside Docker (local dev),
/// detected by the absence of `/.dockerenv`.
pub fn execute(container_id: &str) -> Result<(), ServiceError> {
    // Skip entirely when not running inside Docker.
    if !std::path::Path::new("/.dockerenv").exists() {
        return Ok(());
    }

    // The service container's ID equals the container hostname on Linux Docker.
    let Ok(hostname) = std::env::var("HOSTNAME") else {
        return Ok(());
    };

    let inspect = Command::new("docker")
        .args([
            "inspect",
            "-f",
            "{{range $k, $v := .NetworkSettings.Networks}}{{$k}}\n{{end}}",
            &hostname,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    let Ok(out) = inspect else {
        return Ok(()); // docker inspect failed — not a real container ID.
    };
    if !out.status.success() {
        return Ok(());
    }

    let networks = String::from_utf8_lossy(&out.stdout);
    for network in networks.lines().map(str::trim).filter(|l| !l.is_empty()) {
        // The default "bridge" network does not support container-name DNS.
        // Only user-defined networks are useful for service-to-daemon comms.
        if network == "bridge" {
            continue;
        }

        let connect = Command::new("docker")
            .args(["network", "connect", network, container_id])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| ServiceError::Other(format!("`docker network connect` failed: {e}")))?;

        if !connect.status.success() {
            let stderr = String::from_utf8_lossy(&connect.stderr);
            // "already exists" means the container is already on the network — fine.
            if !stderr.contains("already exists") {
                tracing::warn!("docker network connect {network} {container_id}: {stderr}");
            }
        }
    }

    Ok(())
}
