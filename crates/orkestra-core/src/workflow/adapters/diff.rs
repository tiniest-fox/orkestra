//! Git diff operations using git CLI commands.
//!
//! Provides functions to compute diffs and read file content using git CLI,
//! without requiring the git2 repository mutex.

use std::path::Path;
use std::process::Command;

use crate::workflow::ports::{FileChangeType, FileDiff, GitError, TaskDiff};

/// Compute diff between a task branch and its base branch.
///
/// Runs two git commands in the worktree directory:
/// 1. `git diff --merge-base {base_branch} HEAD` for the unified diff
/// 2. `git diff --merge-base {base_branch} HEAD --numstat` for line counts
///
/// Returns `TaskDiff { files: vec![] }` if there are no changes.
pub fn compute_diff(worktree_path: &Path, base_branch: &str) -> Result<TaskDiff, GitError> {
    // Get the unified diff with full content
    let diff_output = Command::new("git")
        .args([
            "diff",
            "--merge-base",
            base_branch,
            "HEAD",
            "-p",
            "--no-color",
            "--unified=3",
        ])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git diff: {e}")))?;

    if !diff_output.status.success() {
        let stderr = String::from_utf8_lossy(&diff_output.stderr);
        return Err(GitError::IoError(format!("git diff failed: {stderr}")));
    }

    let diff_text = String::from_utf8_lossy(&diff_output.stdout);

    // Get numstat for accurate line counts
    let numstat_output = Command::new("git")
        .args([
            "diff",
            "--merge-base",
            base_branch,
            "HEAD",
            "--numstat",
            "--no-color",
        ])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git diff --numstat: {e}")))?;

    if !numstat_output.status.success() {
        let stderr = String::from_utf8_lossy(&numstat_output.stderr);
        return Err(GitError::IoError(format!(
            "git diff --numstat failed: {stderr}"
        )));
    }

    let numstat_text = String::from_utf8_lossy(&numstat_output.stdout);

    // Parse numstat into a map: path -> (additions, deletions)
    let mut numstat_map = std::collections::HashMap::new();
    for line in numstat_text.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let additions = parts[0].parse::<usize>().unwrap_or(0);
            let deletions = parts[1].parse::<usize>().unwrap_or(0);
            let raw_path = parts[2];

            // Handle rename format: "old => new" or "path/{old => new}"
            let path = if raw_path.contains(" => ") {
                // Full arrow format: "README.md => README_NEW.md"
                if let Some(new_path) = raw_path.split(" => ").nth(1) {
                    new_path.to_string()
                } else {
                    raw_path.to_string()
                }
            } else if raw_path.contains('{') && raw_path.contains(" => ") {
                // Brace format: "src/{old.txt => new.txt}"
                // Extract the part before { and after =>
                if let Some(prefix_end) = raw_path.find('{') {
                    let prefix = &raw_path[..prefix_end];
                    if let Some(arrow_pos) = raw_path.find(" => ") {
                        if let Some(brace_end) = raw_path.find('}') {
                            let new_name = &raw_path[arrow_pos + 4..brace_end];
                            format!("{prefix}{new_name}")
                        } else {
                            raw_path.to_string()
                        }
                    } else {
                        raw_path.to_string()
                    }
                } else {
                    raw_path.to_string()
                }
            } else {
                raw_path.to_string()
            };

            numstat_map.insert(path, (additions, deletions));
        }
    }

    // If diff is empty, return empty file list
    if diff_text.trim().is_empty() {
        return Ok(TaskDiff { files: vec![] });
    }

    // Parse the unified diff output
    let files = parse_unified_diff(&diff_text, &numstat_map);

    Ok(TaskDiff { files })
}

/// Parse unified diff output into a list of `FileDiff` structs.
fn parse_unified_diff(
    diff_text: &str,
    numstat_map: &std::collections::HashMap<String, (usize, usize)>,
) -> Vec<FileDiff> {
    let mut files = Vec::new();
    let mut current_file: Option<FileDiff> = None;
    let mut current_diff_lines = Vec::new();

    for line in diff_text.lines() {
        // New file starts with "diff --git a/... b/..."
        if line.starts_with("diff --git ") {
            // Save the previous file if any
            if let Some(mut file) = current_file.take() {
                // Apply numstat counts now that we have the final path
                if let Some(&(additions, deletions)) = numstat_map.get(&file.path) {
                    file.additions = additions;
                    file.deletions = deletions;
                }

                file.diff_content = if current_diff_lines.is_empty() {
                    None
                } else {
                    Some(current_diff_lines.join("\n"))
                };
                files.push(file);
                current_diff_lines.clear();
            }

            // Start a new file (path will be extracted from headers)
            current_file = Some(FileDiff {
                path: String::new(),
                change_type: FileChangeType::Modified, // Default, will be updated
                old_path: None,
                additions: 0,
                deletions: 0,
                is_binary: false,
                diff_content: None,
            });
        } else if let Some(ref mut file) = current_file {
            // Extract old path from "--- a/..." header (for deleted files and renames)
            if let Some(stripped) = line.strip_prefix("--- a/") {
                let old_path = stripped.to_string();
                // Store it temporarily - we'll decide if it's the main path later
                if file.path.is_empty() {
                    file.path = old_path;
                }
            } else if let Some(stripped) = line.strip_prefix("+++ b/") {
                // Extract new path from "+++ b/..." header
                let new_path = stripped.to_string();
                // For deleted files, this will be "/dev/null", so keep the old path
                if new_path != "/dev/null" {
                    file.path = new_path;
                }
            } else if line.starts_with("new file mode") {
                file.change_type = FileChangeType::Added;
            } else if line.starts_with("deleted file mode") {
                file.change_type = FileChangeType::Deleted;
            } else if let Some(stripped) = line.strip_prefix("rename from ") {
                file.change_type = FileChangeType::Renamed;
                file.old_path = Some(stripped.to_string());
            } else if let Some(stripped) = line.strip_prefix("rename to ") {
                // Set the new path for renamed files (needed when no --- /+++ headers exist)
                file.path = stripped.to_string();
            } else if line.starts_with("Binary files") {
                file.is_binary = true;
                file.diff_content = None;
            } else {
                // Collect diff content lines (after the headers)
                if !line.starts_with("index ")
                    && !line.starts_with("similarity index")
                    && !line.starts_with("--- /dev/null")
                    && !line.starts_with("+++ /dev/null")
                {
                    current_diff_lines.push(line.to_string());
                }
            }
        }
    }

    // Save the last file
    if let Some(mut file) = current_file {
        // Apply numstat counts now that we have the final path
        if let Some(&(additions, deletions)) = numstat_map.get(&file.path) {
            file.additions = additions;
            file.deletions = deletions;
        }

        file.diff_content = if file.is_binary || current_diff_lines.is_empty() {
            None
        } else {
            Some(current_diff_lines.join("\n"))
        };
        files.push(file);
    }

    files
}

/// Read file content at HEAD of the current branch.
///
/// Runs `git show HEAD:{file_path}` in the worktree.
/// Returns `Ok(None)` if the file doesn't exist at HEAD.
pub fn read_file_content(
    worktree_path: &Path,
    file_path: &str,
) -> Result<Option<String>, GitError> {
    let output = Command::new("git")
        .args(["show", &format!("HEAD:{file_path}")])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git show: {e}")))?;

    if !output.status.success() {
        // File doesn't exist at HEAD (or other error like "path not in the working tree")
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not exist") || stderr.contains("path not in the working tree") {
            return Ok(None);
        }
        return Err(GitError::IoError(format!("git show failed: {stderr}")));
    }

    let content = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(Some(content))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    /// Create a test git repository with an initial commit
    fn create_test_repo() -> (TempDir, std::path::PathBuf) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo_path = temp_dir.path().to_path_buf();

        // Initialize git repo
        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to init git repo");

        // Configure git user
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to configure git email");

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to configure git name");

        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "# Test Repo").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add files");
        Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        (temp_dir, repo_path)
    }

    #[test]
    fn test_compute_diff_empty() {
        let (_temp_dir, repo_path) = create_test_repo();

        // No changes yet
        let diff = compute_diff(&repo_path, "HEAD").expect("Failed to compute diff");

        assert!(diff.files.is_empty(), "Should have no files in empty diff");
    }

    #[test]
    fn test_compute_diff_added_file() {
        let (_temp_dir, repo_path) = create_test_repo();

        // Add a new file
        std::fs::write(repo_path.join("new_file.txt"), "Hello, world!").expect("Failed to write");
        Command::new("git")
            .args(["add", "new_file.txt"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Add new file"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        let diff = compute_diff(&repo_path, "HEAD~1").expect("Failed to compute diff");

        assert_eq!(diff.files.len(), 1);
        let file = &diff.files[0];
        assert_eq!(file.path, "new_file.txt");
        assert!(matches!(file.change_type, FileChangeType::Added));
        assert!(file.additions > 0);
        assert_eq!(file.deletions, 0);
        assert!(!file.is_binary);
    }

    #[test]
    fn test_compute_diff_modified_file() {
        let (_temp_dir, repo_path) = create_test_repo();

        // Modify existing file
        std::fs::write(
            repo_path.join("README.md"),
            "# Test Repo\n\nUpdated content",
        )
        .expect("Failed to write");
        Command::new("git")
            .args(["add", "README.md"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Update README"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        let diff = compute_diff(&repo_path, "HEAD~1").expect("Failed to compute diff");

        assert_eq!(diff.files.len(), 1);
        let file = &diff.files[0];
        assert_eq!(file.path, "README.md");
        assert!(matches!(file.change_type, FileChangeType::Modified));
    }

    #[test]
    fn test_compute_diff_deleted_file() {
        let (_temp_dir, repo_path) = create_test_repo();

        // Delete the README
        std::fs::remove_file(repo_path.join("README.md")).expect("Failed to delete");
        Command::new("git")
            .args(["add", "-A"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Delete README"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        let diff = compute_diff(&repo_path, "HEAD~1").expect("Failed to compute diff");

        assert_eq!(diff.files.len(), 1);
        let file = &diff.files[0];
        assert_eq!(file.path, "README.md");
        assert!(matches!(file.change_type, FileChangeType::Deleted));
        assert_eq!(file.additions, 0);
        assert!(file.deletions > 0);
    }

    #[test]
    fn test_read_file_content_existing() {
        let (_temp_dir, repo_path) = create_test_repo();

        let content = read_file_content(&repo_path, "README.md")
            .expect("Failed to read file")
            .expect("File should exist");

        assert_eq!(content.trim(), "# Test Repo");
    }

    #[test]
    fn test_read_file_content_nonexistent() {
        let (_temp_dir, repo_path) = create_test_repo();

        let content =
            read_file_content(&repo_path, "nonexistent.txt").expect("Should succeed with None");

        assert!(content.is_none(), "Should return None for nonexistent file");
    }

    #[test]
    fn test_compute_diff_renamed_file() {
        let (_temp_dir, repo_path) = create_test_repo();

        // Rename a file
        std::fs::rename(repo_path.join("README.md"), repo_path.join("README_NEW.md"))
            .expect("Failed to rename");
        Command::new("git")
            .args(["add", "-A"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to add");
        Command::new("git")
            .args(["commit", "-m", "Rename README"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        let diff = compute_diff(&repo_path, "HEAD~1").expect("Failed to compute diff");

        assert_eq!(diff.files.len(), 1);
        let file = &diff.files[0];
        assert_eq!(file.path, "README_NEW.md");
        assert!(matches!(file.change_type, FileChangeType::Renamed));
        assert_eq!(file.old_path, Some("README.md".to_string()));
    }
}
