//! Find an existing Docker container for an Orkestra project.

use std::process::Command;

/// Return the container ID for `orkestra-{project_id}` if it exists, else `None`.
///
/// Searches all containers (running and stopped) by name filter.
pub fn execute(project_id: &str) -> Option<String> {
    let name = format!("orkestra-{project_id}");
    let output = Command::new("docker")
        .args(["ps", "-a", "--filter", &format!("name={name}"), "-q"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}
