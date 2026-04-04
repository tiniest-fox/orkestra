//! Clone a GitHub repository to a local directory.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use crate::types::ServiceError;

/// Clone `repo_url` into `target_dir` using `git clone`.
///
/// Creates the parent directory if it does not exist. Removes `target_dir`
/// first if it already exists (e.g. from a previous failed clone). Returns an
/// error with `stderr` output if the clone fails or `git` is not found on PATH.
///
/// If `log_path` is provided, git's progress output (stderr) is streamed to
/// that file in real time so users can see clone progress in the service logs.
pub fn execute(
    repo_url: &str,
    target_dir: &Path,
    log_path: Option<&Path>,
) -> Result<(), ServiceError> {
    if let Some(parent) = target_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }

    if target_dir.exists() {
        std::fs::remove_dir_all(target_dir)?;
    }

    let mut child = std::process::Command::new("git")
        .args(["clone", "--progress", repo_url])
        .arg(target_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::Other(format!("Failed to run `git clone`: {e}")))?;

    // Stream stderr (git clone progress) to the log file, accumulate for error reporting.
    let stderr_handle = child.stderr.take().expect("stderr was piped");
    let log_path_buf = log_path.map(Path::to_path_buf);
    let stderr_thread = std::thread::spawn(move || {
        let mut accumulated = String::new();
        let mut log_file = log_path_buf.as_deref().and_then(|p| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)
                .ok()
        });
        for line in BufReader::new(stderr_handle).lines().map_while(Result::ok) {
            if let Some(ref mut f) = log_file {
                let _ = writeln!(f, "{line}");
            }
            accumulated.push_str(&line);
            accumulated.push('\n');
        }
        accumulated
    });

    // Drain stdout (usually empty for git clone).
    let stdout_handle = child.stdout.take().expect("stdout was piped");
    let stdout_thread =
        std::thread::spawn(move || BufReader::new(stdout_handle).lines().for_each(drop));

    let status = child
        .wait()
        .map_err(|e| ServiceError::Other(format!("Failed to wait for `git clone`: {e}")))?;

    let stderr = stderr_thread.join().unwrap_or_default();
    let _ = stdout_thread.join();

    if !status.success() {
        return Err(ServiceError::Other(format!("`git clone` failed: {stderr}")));
    }

    Ok(())
}
