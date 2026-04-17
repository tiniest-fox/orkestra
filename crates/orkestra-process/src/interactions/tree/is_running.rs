//! Check if a process is still running.

/// Check if a process with the given PID is still running.
///
/// On Unix, uses `kill(pid, 0)` which checks if the process exists without sending a signal.
/// On Windows, uses `OpenProcess` to check if the process handle can be opened.
#[allow(clippy::cast_possible_wrap)]
pub fn execute(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        unsafe {
            let handle = windows_sys::Win32::System::Threading::OpenProcess(
                windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if handle.is_null() {
                false
            } else {
                windows_sys::Win32::Foundation::CloseHandle(handle);
                true
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

/// Check if a process is a zombie (dead but not reaped by parent).
///
/// On Unix, shells out to `ps -o state= -p <pid>`. Returns `true` only when
/// the state starts with 'Z'. Returns `false` on any failure (missing `ps`,
/// permission error, unexpected output) — this is the safe default that
/// preserves existing behavior.
pub fn is_zombie(pid: u32) -> bool {
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

    #[test]
    fn test_current_process_is_running() {
        // Our own process should be running
        assert!(execute(std::process::id()));
    }

    #[test]
    fn test_invalid_pid_not_running() {
        // Very high PID should not exist
        assert!(!execute(u32::MAX - 1));
    }

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

        assert!(
            is_zombie(pid),
            "exited-but-unreaped child should be a zombie"
        );
        assert!(
            execute(pid),
            "zombie should still appear as running to kill(pid, 0)"
        );

        // Reap the child — now it should no longer be a zombie
        child.wait().unwrap();
        std::thread::sleep(Duration::from_millis(10));

        assert!(!is_zombie(pid), "reaped process should not be a zombie");
    }

    #[test]
    fn test_live_process_not_zombie() {
        assert!(!is_zombie(std::process::id()));
    }

    #[test]
    fn test_dead_process_not_zombie() {
        assert!(!is_zombie(u32::MAX - 1));
    }
}
