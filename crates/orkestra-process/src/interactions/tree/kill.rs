//! Kill an entire process tree including all descendants.

use std::process::Command;

/// Kill a process and all its descendant processes.
///
/// This ensures that when a process is terminated, all spawned processes
/// (cargo, rustc, shells, etc.) are also killed, preventing orphaned processes.
///
/// Strategy:
/// 1. First collect all descendant PIDs (children create their own process groups)
/// 2. Kill the main process group (catches direct children in same group)
/// 3. Kill any remaining descendants that were in different process groups
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap, clippy::similar_names)]
pub fn execute(pid: u32) -> std::io::Result<()> {
    // Collect all descendants BEFORE killing (they may reparent to init otherwise)
    let descendants = get_descendant_pids(pid);

    // The PID is the process group ID since we spawn with process_group(0)
    let pgid = pid as i32;

    // Continue stopped processes first — SIGTERM is queued but not delivered to
    // stopped processes (SIGTTIN/SIGTSTP). Without SIGCONT, kill is silently ignored.
    unsafe { libc::kill(-pgid, libc::SIGCONT) };

    // First try SIGTERM for graceful shutdown of the main process group
    let result = unsafe { libc::kill(-pgid, libc::SIGTERM) };

    if result != 0 {
        let err = std::io::Error::last_os_error();
        // ESRCH means process doesn't exist - that's fine
        if err.raw_os_error() != Some(libc::ESRCH) {
            // If SIGTERM failed for another reason, try SIGKILL
            unsafe { libc::kill(-pgid, libc::SIGKILL) };
        }
    }

    // Now kill any descendants that were in different process groups
    for desc_pid in descendants {
        let desc_pgid = desc_pid as i32;
        // Continue stopped descendants before terminating
        unsafe { libc::kill(-desc_pgid, libc::SIGCONT) };
        let result = unsafe { libc::kill(-desc_pgid, libc::SIGTERM) };
        if result != 0 {
            unsafe { libc::kill(desc_pgid, libc::SIGCONT) };
            unsafe { libc::kill(desc_pgid, libc::SIGTERM) };
        }
    }

    Ok(())
}

#[cfg(not(unix))]
pub fn execute(pid: u32) -> std::io::Result<()> {
    // On Windows, use taskkill with /T to kill the tree
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()?;
    Ok(())
}

/// Kill a process tree with SIGTERM → grace period → SIGKILL escalation.
///
/// Use this for abnormal exits where the process may be stuck and not
/// responding to SIGTERM.
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap, clippy::similar_names)]
pub fn execute_with_escalation(pid: u32, grace_ms: u64) -> std::io::Result<()> {
    // Collect descendants before signaling — dead processes reparent to init,
    // so pgrep won't find them after SIGTERM.
    let descendants = get_descendant_pids(pid);
    execute(pid)?;
    std::thread::sleep(std::time::Duration::from_millis(grace_ms));
    let pgid = pid as i32;
    unsafe { libc::kill(-pgid, libc::SIGKILL) };
    for desc_pid in descendants {
        unsafe { libc::kill(desc_pid as i32, libc::SIGKILL) };
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn execute_with_escalation(pid: u32, _grace_ms: u64) -> std::io::Result<()> {
    execute(pid)
}

// -- Helpers --

/// Recursively finds all descendant PIDs of a given process.
/// Uses pgrep -P to find children at each level.
#[cfg(unix)]
fn get_descendant_pids(pid: u32) -> Vec<u32> {
    let mut descendants = Vec::new();
    let mut to_check = vec![pid];

    while let Some(parent_pid) = to_check.pop() {
        if let Ok(output) = Command::new("pgrep")
            .args(["-P", &parent_pid.to_string()])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Ok(child_pid) = line.trim().parse::<u32>() {
                        descendants.push(child_pid);
                        to_check.push(child_pid);
                    }
                }
            }
        }
    }

    descendants
}
