//! Check if a process is a zombie (dead but not reaped by parent).

/// Check if a process is a zombie.
///
/// On Unix, shells out to `ps -o state= -p <pid>`. Returns `true` only when
/// the state starts with 'Z'. Returns `false` on any failure (missing `ps`,
/// permission error, unexpected output) — this is the safe default that
/// preserves existing behavior.
pub fn execute(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("ps")
            .args(["-o", "state=", "-p", &pid.to_string()])
            .output();
        match output {
            Ok(out) if out.status.success() => {
                let state = String::from_utf8_lossy(&out.stdout);
                state.trim().starts_with('Z')
            }
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn test_zombie_detected() {
        use std::time::Duration;

        let mut child = std::process::Command::new("sh")
            .args(["-c", "exit 0"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("failed to spawn child");

        let pid = child.id();

        // Give child time to exit and become a zombie
        std::thread::sleep(Duration::from_millis(50));

        assert!(execute(pid), "exited-but-unreaped child should be a zombie");

        // Reap the child — now it should no longer be a zombie
        child.wait().unwrap();
        std::thread::sleep(Duration::from_millis(10));

        assert!(!execute(pid), "reaped process should not be a zombie");
    }

    #[test]
    fn test_live_process_not_zombie() {
        assert!(!execute(std::process::id()));
    }

    #[test]
    fn test_dead_process_not_zombie() {
        assert!(!execute(u32::MAX - 1));
    }
}
