//! Parse git diff output into structured file diffs.

use crate::types::{FileChangeType, FileDiff, TaskDiff};

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
pub fn execute(output: &str) -> TaskDiff {
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
                        total_new_lines: None,
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
                total_new_lines: None,
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
    line.split_whitespace()
        .nth(2)
        .and_then(|s| s.strip_prefix("a/"))
        .map(String::from)
}

/// Determine change type based on git diff markers.
fn determine_change_type(is_new_file: bool, is_deleted_file: bool) -> FileChangeType {
    if is_new_file {
        FileChangeType::Added
    } else if is_deleted_file {
        FileChangeType::Deleted
    } else {
        FileChangeType::Modified
    }
}
