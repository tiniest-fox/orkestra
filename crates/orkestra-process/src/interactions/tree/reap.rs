//! Reap a child process without blocking.

/// Reap a direct child process using non-blocking waitpid.
///
/// Safe to call even if the process is still running (returns immediately)
/// or was already reaped (returns ECHILD, which is ignored).
/// Only effective for direct children of the current process.
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap)]
pub fn execute(pid: u32) {
    unsafe {
        libc::waitpid(pid as i32, std::ptr::null_mut(), libc::WNOHANG);
    }
}

#[cfg(not(unix))]
pub fn execute(_pid: u32) {}
