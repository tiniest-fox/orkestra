//! Spawn a child `orkd` daemon process.

use std::path::Path;
use std::process::{Child, Command, Stdio};

use crate::types::ServiceError;

/// Spawn an `orkd` process for the given project and return the `Child` handle.
///
/// The child is placed in its own process group (via `process_group(0)`) so
/// the entire group can be killed cleanly. Stdin is null; stdout and stderr
/// are discarded.
#[cfg(unix)]
pub fn execute(
    orkd_path: &Path,
    project_root: &str,
    port: u16,
    shared_secret: &str,
    bind: &str,
) -> Result<Child, ServiceError> {
    use std::os::unix::process::CommandExt;

    let child = Command::new(orkd_path)
        .arg("--project-root")
        .arg(project_root)
        .arg("--port")
        .arg(port.to_string())
        .arg("--token")
        .arg(shared_secret)
        .arg("--bind")
        .arg(bind)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()?;

    Ok(child)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn spawns_process_via_execute() {
        // Call execute() with /bin/sh as a stand-in for orkd to verify the
        // spawning mechanism works end-to-end. /bin/sh is universally available
        // on all Unix systems.
        let result = execute(
            std::path::Path::new("/bin/sh"),
            "/tmp",
            3850,
            "test-secret",
            "127.0.0.1",
        );

        assert!(result.is_ok(), "execute() should spawn the process");
        let mut child = result.unwrap();
        child.kill().ok();
        child.wait().ok();
    }
}
