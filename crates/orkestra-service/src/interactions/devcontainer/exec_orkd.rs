//! Launch orkd inside a running container via `docker exec`.

use std::process::{Child, Command, Stdio};

use crate::types::ServiceError;

/// Exec `orkd` in the foreground inside `container_id`.
///
/// The returned `Child` tracks the `docker exec` process on the host.
/// When `orkd` exits inside the container the exec process also exits,
/// which the monitor loop uses to detect crashes.
///
/// stdin is null; stdout/stderr are piped but dropped — capturing them
/// prevents buffer-full blocking while keeping the process group cleanly
/// separated.
#[cfg(unix)]
pub fn execute(container_id: &str, port: u16, secret: &str) -> Result<Child, ServiceError> {
    use std::os::unix::process::CommandExt;

    let child = Command::new("docker")
        .args([
            "exec",
            "-i",
            container_id,
            "/usr/local/bin/orkd",
            "--project-root",
            "/workspace",
            "--port",
            &port.to_string(),
            "--token",
            secret,
            "--bind",
            "0.0.0.0",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()?;

    Ok(child)
}
