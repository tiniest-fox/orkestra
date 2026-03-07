//! Poll a daemon port to check if it is ready to accept connections.

use std::process::{Command, Stdio};

/// Return `true` if `orkd` inside `container_id` is accepting TCP connections
/// on `port`. Probes from inside the container via `docker exec` so that the
/// check works in Docker-outside-of-Docker setups where the service container
/// cannot reach ports bound on the host's loopback.
pub fn execute(container_id: &str, port: u16) -> bool {
    let probe = format!("exec 3<>/dev/tcp/127.0.0.1/{port} 2>/dev/null");
    let Ok(output) = Command::new("docker")
        .args(["exec", container_id, "bash", "-c", &probe])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return false;
    };
    output.status.success()
}
