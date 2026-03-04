//! In-memory registry for run script processes with log capture.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::BufRead;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub use orkestra_types::config::RUN_SCRIPT_RELATIVE_PATH;

const MAX_LOG_LINES: usize = 5000;

/// Status of a run script process for a task.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RunStatus {
    pub running: bool,
    pub pid: Option<u32>,
    /// Exit code if the process has exited.
    pub exit_code: Option<i32>,
}

/// Log lines returned from a run script process.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RunLogs {
    /// New lines since the requested offset.
    pub lines: Vec<String>,
    /// Total lines produced so far (use as `since_line` for next poll).
    pub total_lines: usize,
}

/// Ring buffer combining captured output with a monotonically increasing line count.
///
/// Held behind a single `Mutex` so `total` and `lines` are always read atomically,
/// eliminating the TOCTOU race that exists when they are separate synchronization
/// primitives.
struct LogBuffer {
    lines: VecDeque<String>,
    total: usize,
}

/// A tracked run script process with captured output.
struct RunProcess {
    pid: u32,
    exited: Arc<AtomicBool>,
    exit_code: Arc<Mutex<Option<i32>>>,
    log_buffer: Arc<Mutex<LogBuffer>>,
}

impl Drop for RunProcess {
    fn drop(&mut self) {
        if !self.exited.load(Ordering::Relaxed) {
            let _ = orkestra_core::process::kill_process_tree(self.pid);
        }
    }
}

/// Registry of run script processes, keyed by task ID.
pub struct RunProcessRegistry {
    processes: Mutex<HashMap<String, RunProcess>>,
    run_pids: Arc<Mutex<Vec<u32>>>,
}

/// Kill all PIDs in the list — for use from signal handler context.
///
/// Iterates the list and kills each PID's process tree. Best-effort;
/// individual failures are ignored.
pub(crate) fn kill_all_pids(pids: &Mutex<Vec<u32>>) {
    if let Ok(pids) = pids.lock() {
        for &pid in pids.iter() {
            let _ = orkestra_core::process::kill_process_tree(pid);
        }
    }
}

impl RunProcessRegistry {
    /// Create an empty registry with the given PID tracking list.
    ///
    /// `run_pids` is shared with the signal handler so it can kill run processes
    /// without access to app state.
    pub fn new(run_pids: Arc<Mutex<Vec<u32>>>) -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
            run_pids,
        }
    }

    /// Start a run script for the given task.
    ///
    /// Returns the existing status if the process is already running.
    /// Returns an error if the run script doesn't exist or the process fails to spawn.
    pub fn start(
        &self,
        task_id: &str,
        project_root: &Path,
        worktree_path: &Path,
    ) -> Result<RunStatus, String> {
        let mut processes = self
            .processes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        // Prevent double-start: return existing status if already running.
        if let Some(entry) = processes.get(task_id) {
            if !entry.exited.load(Ordering::Relaxed) {
                return Ok(RunStatus {
                    running: true,
                    pid: Some(entry.pid),
                    exit_code: None,
                });
            }
            // Stale entry from a previous run — remove it before spawning a new one.
            processes.remove(task_id);
        }

        let run_script_path = project_root.join(RUN_SCRIPT_RELATIVE_PATH);
        if !run_script_path.exists() {
            return Err(format!(
                "Run script not found: {}",
                run_script_path.display()
            ));
        }

        let mut cmd = Command::new("bash");
        cmd.arg(&run_script_path)
            .arg(worktree_path)
            .current_dir(worktree_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn run.sh: {e}"))?;

        let pid = child.id();

        // Register PID for signal handler cleanup.
        if let Ok(mut pids) = self.run_pids.lock() {
            pids.push(pid);
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let exited = Arc::new(AtomicBool::new(false));
        let exit_code: Arc<Mutex<Option<i32>>> = Arc::new(Mutex::new(None));
        let log_buffer: Arc<Mutex<LogBuffer>> = Arc::new(Mutex::new(LogBuffer {
            lines: VecDeque::new(),
            total: 0,
        }));

        // Spawn reader threads for stdout and stderr.
        if let Some(stdout) = stdout {
            let buf = Arc::clone(&log_buffer);
            thread::spawn(move || stream_lines_to_buffer(stdout, buf));
        }
        if let Some(stderr) = stderr {
            let buf = Arc::clone(&log_buffer);
            thread::spawn(move || stream_lines_to_buffer(stderr, buf));
        }

        // Spawn waiter thread to reap the child and record exit code.
        {
            let exited_clone = Arc::clone(&exited);
            let exit_code_clone = Arc::clone(&exit_code);
            let run_pids_clone = Arc::clone(&self.run_pids);
            let pid_for_waiter = pid;
            thread::spawn(move || {
                let status = child.wait();
                let code = match status {
                    Ok(s) => s.code(),
                    Err(_) => None,
                };
                *exit_code_clone
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = code;
                exited_clone.store(true, Ordering::Relaxed);

                // Remove PID from tracking list.
                if let Ok(mut pids) = run_pids_clone.lock() {
                    pids.retain(|&p| p != pid_for_waiter);
                }
            });
        }

        processes.insert(
            task_id.to_string(),
            RunProcess {
                pid,
                exited,
                exit_code,
                log_buffer,
            },
        );

        Ok(RunStatus {
            running: true,
            pid: Some(pid),
            exit_code: None,
        })
    }

    /// Stop the run script for the given task.
    ///
    /// No-op if no process is running for this task. The entry remains in the
    /// registry so the frontend can still fetch final log lines after stop.
    pub fn stop(&self, task_id: &str) {
        let processes = self
            .processes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        if let Some(entry) = processes.get(task_id) {
            if !entry.exited.load(Ordering::Relaxed) {
                let _ = orkestra_core::process::kill_process_tree(entry.pid);
                entry.exited.store(true, Ordering::Relaxed);
            }
        }
    }

    /// Get the current status of the run script for the given task.
    pub fn status(&self, task_id: &str) -> RunStatus {
        let processes = self
            .processes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        match processes.get(task_id) {
            None => RunStatus {
                running: false,
                pid: None,
                exit_code: None,
            },
            Some(entry) => {
                let is_exited = entry.exited.load(Ordering::Relaxed);
                let code = if is_exited {
                    *entry
                        .exit_code
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                } else {
                    None
                };
                RunStatus {
                    running: !is_exited,
                    pid: Some(entry.pid),
                    exit_code: code,
                }
            }
        }
    }

    /// Get log lines produced since `since_line`.
    ///
    /// Returns all buffered lines if the requested offset has been evicted from
    /// the ring buffer (i.e., `since_line < total_lines - buffer_len`).
    pub fn logs(&self, task_id: &str, since_line: usize) -> RunLogs {
        let processes = self
            .processes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        let Some(entry) = processes.get(task_id) else {
            return RunLogs {
                lines: vec![],
                total_lines: 0,
            };
        };

        // Acquire the log buffer once to read both `total` and `lines` atomically.
        let buf = entry
            .log_buffer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let total = buf.total;

        if total <= since_line {
            // No new lines.
            return RunLogs {
                lines: vec![],
                total_lines: total,
            };
        }

        let new_count = total - since_line;
        // The oldest line still in the buffer is at index `total - buf.lines.len()`.
        let oldest_available = total.saturating_sub(buf.lines.len());

        let lines: Vec<String> = if since_line < oldest_available {
            // Requested offset has been evicted; return entire buffer.
            buf.lines.iter().cloned().collect()
        } else {
            // Return the last `new_count` lines from the buffer.
            let skip = buf.lines.len().saturating_sub(new_count);
            buf.lines.iter().skip(skip).cloned().collect()
        };

        RunLogs {
            lines,
            total_lines: total,
        }
    }

    /// Stop all tracked run processes (used on window close and app exit).
    pub fn stop_all(&self) {
        let mut processes = self
            .processes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        processes.drain();
        // Drop impl on each RunProcess kills any still-running ones.
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Stream lines from `reader` into `log_buffer`, evicting oldest when full.
fn stream_lines_to_buffer(reader: impl std::io::Read, log_buffer: Arc<Mutex<LogBuffer>>) {
    let reader = std::io::BufReader::new(reader);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let mut buf = log_buffer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if buf.lines.len() >= MAX_LOG_LINES {
            buf.lines.pop_front();
        }
        buf.lines.push_back(line);
        buf.total += 1;
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
impl RunProcessRegistry {
    /// Insert a synthetic entry for unit testing without spawning a real process.
    fn insert_test_entry(
        &self,
        task_id: &str,
        log_buffer: Arc<Mutex<LogBuffer>>,
        exited: bool,
        pid: u32,
    ) {
        let mut processes = self
            .processes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        processes.insert(
            task_id.to_string(),
            RunProcess {
                pid,
                exited: Arc::new(AtomicBool::new(exited)),
                exit_code: Arc::new(Mutex::new(None)),
                log_buffer,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_registry() -> RunProcessRegistry {
        RunProcessRegistry::new(Arc::new(Mutex::new(Vec::new())))
    }

    fn make_log_buffer(lines: Vec<&str>, total: usize) -> Arc<Mutex<LogBuffer>> {
        Arc::new(Mutex::new(LogBuffer {
            lines: lines.iter().map(|s| (*s).to_string()).collect(),
            total,
        }))
    }

    #[test]
    fn logs_empty_for_unknown_task() {
        let reg = make_registry();
        let result = reg.logs("nonexistent", 0);
        assert!(result.lines.is_empty());
        assert_eq!(result.total_lines, 0);
    }

    #[test]
    fn logs_partial_read_returns_new_lines() {
        let reg = make_registry();
        // 5 lines total in buffer, total=5. since_line=3 → lines 3 and 4 are new.
        let buf = make_log_buffer(vec!["a", "b", "c", "d", "e"], 5);
        reg.insert_test_entry("t1", buf, true, 99999);

        let result = reg.logs("t1", 3);
        assert_eq!(result.total_lines, 5);
        assert_eq!(result.lines, vec!["d", "e"]);
    }

    #[test]
    fn logs_evicted_returns_entire_buffer() {
        let reg = make_registry();
        // Buffer holds MAX_LOG_LINES lines, total = MAX_LOG_LINES + 100 (eviction occurred).
        let lines: Vec<&str> = vec!["line"; MAX_LOG_LINES];
        let total = MAX_LOG_LINES + 100;
        let buf = make_log_buffer(lines, total);
        reg.insert_test_entry("t2", buf, false, 99998);

        // since_line=0 < oldest_available (100) → returns all buffered lines.
        let result = reg.logs("t2", 0);
        assert_eq!(result.total_lines, total);
        assert_eq!(result.lines.len(), MAX_LOG_LINES);
    }

    #[test]
    fn stop_marks_entry_exited() {
        let reg = make_registry();
        let buf = make_log_buffer(vec!["final line"], 1);
        reg.insert_test_entry("t3", buf, false, 99997);

        reg.stop("t3");

        // Entry remains in registry (for final log fetch) but is marked exited
        let status = reg.status("t3");
        assert!(!status.running, "process should not be running after stop");
        // Logs should still be accessible after stop
        let logs = reg.logs("t3", 0);
        assert_eq!(logs.lines, vec!["final line"]);
    }
}
