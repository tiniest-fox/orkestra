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
}
