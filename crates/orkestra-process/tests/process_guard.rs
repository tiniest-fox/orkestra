//! Integration tests for `ProcessGuard` lifecycle and descendant cleanup.

#[cfg(unix)]
mod unix {
    use std::io::Read;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    fn process_exists(pid: u32) -> bool {
        orkestra_process::is_process_running(pid)
    }

    /// Disarmed guard must still send SIGTERM to the process group, killing descendants.
    #[test]
    fn disarmed_guard_kills_descendants() {
        // Parent shell spawns a background sleep (the descendant).
        // We print the child PID so we can verify it dies too.
        let mut child = Command::new("sh")
            .args(["-c", "sleep 60 & echo $!; wait"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .expect("spawn failed");

        let parent_pid = child.id();

        // Read the grandchild PID printed by `echo $!`
        let mut stdout = child.stdout.take().unwrap();
        let mut buf = String::new();
        let mut byte = [0u8; 1];
        loop {
            if stdout.read(&mut byte).unwrap_or(0) == 0 {
                break;
            }
            if byte[0] == b'\n' {
                break;
            }
            buf.push(byte[0] as char);
        }
        let grandchild_pid: u32 = buf.trim().parse().expect("expected numeric PID");

        // Give processes time to start
        std::thread::sleep(std::time::Duration::from_millis(100));

        assert!(process_exists(parent_pid), "parent should be running");
        assert!(
            process_exists(grandchild_pid),
            "grandchild should be running"
        );

        let guard = orkestra_process::ProcessGuard::new(parent_pid);
        guard.disarm();
        drop(guard);

        // Allow signals to propagate
        std::thread::sleep(std::time::Duration::from_millis(300));

        // Reap the shell zombie so kill(pid, 0) returns ESRCH
        let _ = child.wait();

        assert!(
            !process_exists(parent_pid),
            "parent should be dead after disarmed guard drop"
        );
        assert!(
            !process_exists(grandchild_pid),
            "grandchild should be dead after disarmed guard drop"
        );
    }

    /// Non-disarmed guard must escalate to SIGKILL for SIGTERM-resistant processes.
    #[test]
    fn non_disarmed_guard_escalates_to_sigkill() {
        // This process traps SIGTERM (and exec'd children inherit SIG_IGN), so
        // neither the shell nor `sleep 60` will die from SIGTERM alone.
        let mut child = Command::new("sh")
            .args(["-c", "trap '' TERM; sleep 60"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .expect("spawn failed");

        let pid = child.id();

        // Let the trap install
        std::thread::sleep(std::time::Duration::from_millis(100));

        assert!(process_exists(pid), "process should be running before drop");

        // Drop without disarming — triggers SIGTERM → 2s sleep → SIGKILL.
        // drop() blocks until the grace period elapses.
        let guard = orkestra_process::ProcessGuard::new(pid);
        drop(guard);

        // Reap the zombie so kill(pid, 0) returns ESRCH
        let _ = child.wait();

        assert!(
            !process_exists(pid),
            "SIGTERM-resistant process should be dead after SIGKILL escalation"
        );
    }
}
