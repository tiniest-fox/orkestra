//! Run the toolbox setup script inside a project container.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::interactions::devcontainer::ensure_toolbox_volume::TOOLBOX_MOUNT_PATH;
use crate::types::ServiceError;

/// Run `/opt/orkestra/setup.sh` inside `container_id` as root.
///
/// Creates symlinks from `/opt/orkestra/bin/*` into `/usr/local/bin/`,
/// resolves or creates the uid 1000 user, and configures git identity.
/// Idempotent — safe to run multiple times.
///
/// If `log_path` is provided, any stderr output is written there on failure.
pub fn execute(container_id: &str, log_path: Option<&Path>) -> Result<(), ServiceError> {
    let setup_script = format!("{TOOLBOX_MOUNT_PATH}/setup.sh");
    let output = Command::new("docker")
        .args(["exec", "-u", "root", container_id, "sh", &setup_script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            ServiceError::Other(format!(
                "Failed to run toolbox setup via `docker exec`: {e}"
            ))
        })?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if let Some(lp) = log_path {
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(lp)
            {
                let _ = writeln!(f, "Toolbox setup stderr: {stderr}");
            }
        }
        Err(ServiceError::Other(format!(
            "Toolbox setup script failed in container {container_id}: {stderr}"
        )))
    }
}
