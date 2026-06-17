//! Reap a child process without blocking.

/// Reap a direct child process using non-blocking waitpid.
///
/// Safe to call even if the process is still running (returns immediately)
/// or was already reaped (returns ECHILD, which is ignored).
/// Only effective for direct children of the current process.
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap)]
pub fn execute(pid: u32) {
    // SAFETY: `waitpid` with `WNOHANG` is non-blocking and safe for any PID.
    // Passing `null_mut()` for status is valid (exit status not needed).
    // If `pid` is not a child, returns ECHILD which we ignore.
    unsafe {
        libc::waitpid(pid as i32, std::ptr::null_mut(), libc::WNOHANG);
    }
}

#[cfg(not(unix))]
pub fn execute(_pid: u32) {}
