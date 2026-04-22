//! Remove the per-project Claude auth Docker named volume.

use std::process::{Command, Stdio};

/// Remove the `orkestra-claude-{project_id}` named volume (best-effort).
///
/// Called during project deletion to avoid orphaned volumes accumulating over
/// time. Succeeds silently if the volume does not exist.
pub fn execute(project_id: &str) {
    let volume_name = format!("orkestra-claude-{project_id}");
    let _ = Command::new("docker")
        .args(["volume", "rm", &volume_name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
