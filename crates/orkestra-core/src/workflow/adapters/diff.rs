//! Git diff CLI execution and parsing.

use std::path::Path;
use std::process::Command;

use crate::workflow::ports::{FileChangeType, FileDiff, GitError, TaskDiff};

/// Execute git diff and parse output into structured diff data.
///
/// Uses `git diff --merge-base` to compute the diff from the merge-base of
/// `base_branch` to the working tree, showing both committed and uncommitted
/// changes made on the task branch.
pub fn execute_diff(
    worktree_path: &Path,
    _branch_name: &str,
    base_branch: &str,
) -> Result<TaskDiff, GitError> {
    let output = Command::new("git")
        .args([
            "diff",
            "--merge-base",
            base_branch,
            "--unified=3",
            "--no-color",
            "--numstat",
            "--no-renames", // Simplify initial implementation
            "-p",
        ])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to execute git diff: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::IoError(format!("git diff failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_diff_output(&stdout))
}

/// Parse git diff output into structured `FileDiff` objects.
///
/// Expected format:
/// ```text
/// 5       2       path/to/file.rs
/// 10      0       path/to/other.rs
/// diff --git a/path/to/file.rs b/path/to/file.rs
/// index abc123..def456 100644
/// --- a/path/to/file.rs
/// +++ b/path/to/file.rs
/// @@ -1,5 +1,7 @@
///  context line
/// -deleted line
/// +added line
/// ```
fn parse_diff_output(output: &str) -> TaskDiff {
    let mut files = Vec::new();
    let mut lines = output.lines().peekable();

    // Parse numstat section first
    let mut numstats: Vec<(String, usize, usize)> = Vec::new();
    while let Some(line) = lines.peek() {
        if line.starts_with("diff --git") {
            break;
        }
        if let Some(line) = lines.next() {
            if let Some((path, additions, deletions)) = parse_numstat_line(line) {
                numstats.push((path, additions, deletions));
            }
        }
    }

    // Parse actual diffs
    let mut current_file: Option<String> = None;
    let mut current_diff = String::new();
    let mut is_new_file = false;
    let mut is_deleted_file = false;

    for line in lines {
        if line.starts_with("diff --git") {
            // Save previous file
            if let Some(path) = current_file.take() {
                if let Some((_, additions, deletions)) =
                    numstats.iter().find(|(p, _, _)| p == &path)
                {
                    files.push(FileDiff {
                        path: path.clone(),
                        change_type: determine_change_type(is_new_file, is_deleted_file),
                        old_path: None,
                        additions: *additions,
                        deletions: *deletions,
                        is_binary: current_diff.contains("Binary files"),
                        diff_content: if current_diff.contains("Binary files") {
                            None
                        } else {
                            Some(current_diff.clone())
                        },
                    });
                }
                current_diff.clear();
                is_new_file = false;
                is_deleted_file = false;
            }

            // Extract file path from "diff --git a/path b/path"
            if let Some(path) = extract_file_path(line) {
                current_file = Some(path);
            }
        }

        // Detect new files (old side is /dev/null)
        if line.starts_with("--- /dev/null") {
            is_new_file = true;
        }
        // Detect deleted files (new side is /dev/null)
        if line.starts_with("+++ /dev/null") {
            is_deleted_file = true;
        }

        current_diff.push_str(line);
        current_diff.push('\n');
    }

    // Save last file
    if let Some(path) = current_file {
        if let Some((_, additions, deletions)) = numstats.iter().find(|(p, _, _)| p == &path) {
            files.push(FileDiff {
                path: path.clone(),
                change_type: determine_change_type(is_new_file, is_deleted_file),
                old_path: None,
                additions: *additions,
                deletions: *deletions,
                is_binary: current_diff.contains("Binary files"),
                diff_content: if current_diff.contains("Binary files") {
                    None
                } else {
                    Some(current_diff)
                },
            });
        }
    }

    TaskDiff { files }
}

/// Parse a numstat line: "5\t2\tpath/to/file.rs"
fn parse_numstat_line(line: &str) -> Option<(String, usize, usize)> {
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() != 3 {
        return None;
    }

    let additions = parts[0].parse::<usize>().ok()?;
    let deletions = parts[1].parse::<usize>().ok()?;
    let path = parts[2].to_string();

    Some((path, additions, deletions))
}

/// Extract file path from "diff --git a/path/to/file b/path/to/file"
fn extract_file_path(line: &str) -> Option<String> {
    // Format: "diff --git a/<path> b/<path>"
    line.split_whitespace()
        .nth(2)
        .and_then(|s| s.strip_prefix("a/"))
        .map(String::from)
}

/// Determine change type based on git diff markers.
///
/// - New files have `--- /dev/null` (old side doesn't exist)
/// - Deleted files have `+++ /dev/null` (new side doesn't exist)
/// - Everything else is modified
fn determine_change_type(is_new_file: bool, is_deleted_file: bool) -> FileChangeType {
    if is_new_file {
        FileChangeType::Added
    } else if is_deleted_file {
        FileChangeType::Deleted
    } else {
        FileChangeType::Modified
    }
}

/// Read file content at HEAD in a worktree.
pub fn read_file_at_head(
    worktree_path: &Path,
    file_path: &str,
) -> Result<Option<String>, GitError> {
    let output = Command::new("git")
        .args(["show", &format!("HEAD:{file_path}")])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to read file at HEAD: {e}")))?;

    if !output.status.success() {
        // File might not exist at HEAD
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not exist") || stderr.contains("exists on disk, but not in") {
            return Ok(None);
        }
        return Err(GitError::IoError(format!("git show failed: {stderr}")));
    }

    Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
}
