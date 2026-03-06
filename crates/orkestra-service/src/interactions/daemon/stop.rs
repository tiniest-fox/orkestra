//! Stop a running daemon process with graceful shutdown and SIGKILL fallback.

use std::process::Child;
use std::time::{Duration, Instant};

/// Stop a child daemon process.
///
/// Sends SIGCONT + SIGTERM to the process group, waits up to `timeout` for
/// the process to exit, then escalates to SIGKILL if it is still alive.
/// Always sends SIGCONT before SIGTERM — stopped processes queue but do not
/// deliver SIGTERM without it.
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap)]
pub fn execute(child: &mut Child, timeout: Duration) {
    let pgid = child.id() as i32;

    // Wake stopped processes, then request graceful shutdown.
    // SAFETY: pgid is a valid process group ID obtained from `child.id()` which
    // returns a positive PID. Negating it targets the process group.
    unsafe { libc::kill(-pgid, libc::SIGCONT) };
    // SAFETY: same as above — targeting the same process group.
    unsafe { libc::kill(-pgid, libc::SIGTERM) };

    // Poll until exit or timeout.
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // Timeout reached — force kill the process group.
    // SAFETY: pgid is obtained from `child.id()` (positive PID); negating it targets the group.
    unsafe { libc::kill(-pgid, libc::SIGCONT) };
    // SAFETY: same as above.
    unsafe { libc::kill(-pgid, libc::SIGKILL) };
    let _ = child.wait();
}
