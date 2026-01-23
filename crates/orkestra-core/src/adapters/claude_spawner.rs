use std::io::{BufRead, Write as IoWrite};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::error::Result;
use crate::ports::{ProcessSpawner, SpawnConfig, SpawnedProcess};

/// Claude CLI process spawner implementation.
pub struct ClaudeSpawner;

impl ClaudeSpawner {
    /// Find the ork CLI binary path.
    fn find_cli_path() -> Option<PathBuf> {
        // First check if ork is in PATH
        if let Ok(output) = Command::new("which").arg("ork").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }

        // Check relative to current directory (development mode)
        let dev_path = std::env::current_dir().ok()?.join("target/debug/ork");
        if dev_path.exists() {
            return Some(dev_path);
        }

        // Check relative to git repo root (for worktrees)
        // Use git rev-parse --show-toplevel to find the actual repo root
        if let Ok(output) = Command::new("git")
            .args(["rev-parse", "--show-toplevel"])
            .output()
        {
            if output.status.success() {
                let repo_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let git_root_path = PathBuf::from(&repo_root).join("target/debug/ork");
                if git_root_path.exists() {
                    return Some(git_root_path);
                }
            }
        }

        // Walk up the directory tree looking for target/debug/ork
        // This handles worktrees at .orkestra/worktrees/TASK-XXX where the main
        // repo is at ../../../
        if let Ok(cwd) = std::env::current_dir() {
            let mut path = cwd.as_path();
            while let Some(parent) = path.parent() {
                let candidate = parent.join("target/debug/ork");
                if candidate.exists() {
                    return Some(candidate);
                }
                path = parent;
            }
        }

        None
    }

    /// Build the PATH environment variable with CLI directory.
    fn build_path_env() -> String {
        let mut path_env = std::env::var("PATH").unwrap_or_default();
        if let Some(cli_path) = Self::find_cli_path() {
            if let Some(parent) = cli_path.parent() {
                path_env = format!("{}:{}", parent.display(), path_env);
            }
        }
        path_env
    }

    /// Parse a streaming JSON event to extract `session_id`.
    fn parse_session_id(json_line: &str) -> Option<String> {
        let v: serde_json::Value = serde_json::from_str(json_line).ok()?;

        // Check for system init events which contain session_id
        if v.get("type").and_then(|t| t.as_str()) == Some("system")
            && v.get("subtype").and_then(|s| s.as_str()) == Some("init")
        {
            return v
                .get("session_id")
                .and_then(|s| s.as_str())
                .map(std::string::ToString::to_string);
        }

        None
    }

    /// Check if an event indicates meaningful new content.
    fn has_new_content(json_line: &str) -> bool {
        let v: serde_json::Value = match serde_json::from_str(json_line) {
            Ok(v) => v,
            Err(_) => return false,
        };

        let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // System init events
        if event_type == "system" && v.get("subtype").and_then(|s| s.as_str()) == Some("init") {
            return true;
        }

        // Assistant message events
        if event_type == "assistant" && v.get("message").is_some() {
            return true;
        }

        // Result events
        if event_type == "result" {
            return true;
        }

        false
    }
}

impl ProcessSpawner for ClaudeSpawner {
    fn spawn(
        &self,
        config: SpawnConfig,
        on_output: Box<dyn Fn() + Send>,
    ) -> Result<SpawnedProcess> {
        let path_env = Self::build_path_env();

        let mut child = Command::new("claude")
            .args(config.args)
            .env("PATH", path_env)
            .current_dir(config.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // Write the prompt to stdin
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(config.stdin_content.as_bytes())?;
        }

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Spawn background thread for output processing
        std::thread::spawn(move || {
            // Spawn a thread to read stderr in parallel
            let stderr_handle = stderr.map(|stderr| {
                std::thread::spawn(move || {
                    let reader = std::io::BufReader::new(stderr);
                    let mut stderr_lines = Vec::new();
                    for line in reader.lines().map_while(std::result::Result::ok) {
                        stderr_lines.push(line);
                    }
                    stderr_lines
                })
            });

            if let Some(stdout) = stdout {
                let reader = std::io::BufReader::new(stdout);

                for line in reader.lines().map_while(std::result::Result::ok) {
                    if line.trim().is_empty() {
                        continue;
                    }

                    // Only notify UI when there's meaningful new content
                    if Self::has_new_content(&line) {
                        on_output();
                    }
                }
            }

            // Collect stderr output for logging
            if let Some(handle) = stderr_handle {
                if let Ok(stderr_lines) = handle.join() {
                    if !stderr_lines.is_empty() {
                        eprintln!("Agent stderr: {}", stderr_lines.join("\n"));
                    }
                }
            }

            // Wait for the process to complete
            match child.wait() {
                Ok(status) => {
                    eprintln!("Agent finished with exit code: {:?}", status.code());
                    on_output();
                }
                Err(e) => {
                    eprintln!("Agent error: {e}");
                    on_output();
                }
            }
        });

        Ok(SpawnedProcess {
            pid,
            session_id: None,
        })
    }

    fn spawn_and_wait_for_session(
        &self,
        config: SpawnConfig,
        timeout_secs: u64,
    ) -> Result<SpawnedProcess> {
        let path_env = Self::build_path_env();

        let mut child = Command::new("claude")
            .args(config.args)
            .env("PATH", path_env)
            .current_dir(config.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // Write the prompt to stdin
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(config.stdin_content.as_bytes())?;
        }

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Read stdout synchronously until we get the session_id or timeout
        let mut captured_session_id: Option<String> = None;

        if let Some(stdout) = stdout {
            let (tx, rx) = mpsc::channel::<String>();

            // Spawn thread to read lines
            let reader_thread = std::thread::spawn(move || {
                let reader = std::io::BufReader::new(stdout);
                for line in reader.lines().map_while(std::result::Result::ok) {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });

            let start = Instant::now();
            let timeout = Duration::from_secs(timeout_secs);

            while start.elapsed() < timeout {
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(line) => {
                        if let Some(sid) = Self::parse_session_id(&line) {
                            captured_session_id = Some(sid);
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }

            // Don't join the reader thread - let it run in the background
            // with the child process
            drop(reader_thread);
        }

        // Spawn background thread for stderr and process completion
        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                let reader = std::io::BufReader::new(stderr);
                for line in reader.lines().map_while(std::result::Result::ok) {
                    eprintln!("Agent stderr: {line}");
                }
            });
        }

        // Spawn thread to wait for completion
        std::thread::spawn(move || {
            let _ = child.wait();
        });

        Ok(SpawnedProcess {
            pid,
            session_id: captured_session_id,
        })
    }

    fn resume(
        &self,
        session_id: &str,
        config: SpawnConfig,
        on_output: Box<dyn Fn() + Send>,
    ) -> Result<SpawnedProcess> {
        let path_env = Self::build_path_env();

        // Build args with --resume flag
        let mut args: Vec<&str> = vec!["--resume", session_id];
        args.extend_from_slice(config.args);

        let mut child = Command::new("claude")
            .args(&args)
            .env("PATH", path_env)
            .current_dir(config.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // Write the continuation prompt to stdin
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(config.stdin_content.as_bytes())?;
        }

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Spawn background thread for output processing
        std::thread::spawn(move || {
            let stderr_handle = stderr.map(|stderr| {
                std::thread::spawn(move || {
                    let reader = std::io::BufReader::new(stderr);
                    for line in reader.lines().map_while(std::result::Result::ok) {
                        eprintln!("Agent stderr: {line}");
                    }
                })
            });

            if let Some(stdout) = stdout {
                let reader = std::io::BufReader::new(stdout);

                for line in reader.lines().map_while(std::result::Result::ok) {
                    if line.trim().is_empty() {
                        continue;
                    }

                    if Self::has_new_content(&line) {
                        on_output();
                    }
                }
            }

            if let Some(handle) = stderr_handle {
                let _ = handle.join();
            }

            match child.wait() {
                Ok(status) => {
                    eprintln!("Agent finished with exit code: {:?}", status.code());
                    on_output();
                }
                Err(e) => {
                    eprintln!("Agent error: {e}");
                    on_output();
                }
            }
        });

        Ok(SpawnedProcess {
            pid,
            session_id: Some(session_id.to_string()),
        })
    }

    fn is_running(&self, pid: u32) -> bool {
        #[cfg(unix)]
        {
            unsafe { libc::kill(i32::try_from(pid).unwrap_or(i32::MAX), 0) == 0 }
        }
        #[cfg(not(unix))]
        {
            let _ = pid;
            false
        }
    }
}
