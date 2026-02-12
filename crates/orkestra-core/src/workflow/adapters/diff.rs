//! Git diff CLI execution and parsing.

use std::fmt::Write;
use std::fs;
use std::path::Path;
use std::process::Command;

use crate::workflow::ports::{FileChangeType, FileDiff, GitError, TaskDiff};

/// Execute git diff and parse output into structured diff data.
///
/// Uses `git diff --merge-base` to compute the diff from the merge-base of
/// `base_branch` to the working tree, showing both committed and uncommitted
/// changes made on the task branch. Also includes untracked files as new files.
pub fn execute_diff(
    worktree_path: &Path,
    _branch_name: &str,
    base_branch: &str,
) -> Result<TaskDiff, GitError> {
    // Get tracked changes via git diff
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
    let mut task_diff = parse_diff_output(&stdout);

    // Add untracked files as new additions
    let untracked = get_untracked_files(worktree_path)?;
    for path in untracked {
        if let Some(file_diff) = create_untracked_file_diff(worktree_path, &path) {
            task_diff.files.push(file_diff);
        }
    }

    Ok(task_diff)
}

/// Get list of untracked files (excluding ignored files).
fn get_untracked_files(worktree_path: &Path) -> Result<Vec<String>, GitError> {
    let output = Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to list untracked files: {e}")))?;

    if !output.status.success() {
        // Non-fatal: just return empty list
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().map(String::from).collect())
}

/// Create a [`FileDiff`] for an untracked file by reading its content.
fn create_untracked_file_diff(worktree_path: &Path, path: &str) -> Option<FileDiff> {
    let full_path = worktree_path.join(path);

    // Skip directories
    if full_path.is_dir() {
        return None;
    }

    // Check if it's a binary file (simple heuristic: check for null bytes)
    let content = fs::read(&full_path).ok()?;
    let is_binary = content.contains(&0);

    if is_binary {
        return Some(FileDiff {
            path: path.to_string(),
            change_type: FileChangeType::Added,
            old_path: None,
            additions: 0,
            deletions: 0,
            is_binary: true,
            diff_content: None,
        });
    }

    // Convert to string and create synthetic diff
    let text = String::from_utf8_lossy(&content);
    let lines: Vec<&str> = text.lines().collect();
    let line_count = lines.len();

    // Build synthetic unified diff content
    let mut diff_content = String::new();
    let _ = writeln!(diff_content, "diff --git a/{path} b/{path}");
    diff_content.push_str("new file mode 100644\n");
    diff_content.push_str("--- /dev/null\n");
    let _ = writeln!(diff_content, "+++ b/{path}");
    let _ = writeln!(diff_content, "@@ -0,0 +1,{line_count} @@");
    for line in &lines {
        diff_content.push('+');
        diff_content.push_str(line);
        diff_content.push('\n');
    }

    Some(FileDiff {
        path: path.to_string(),
        change_type: FileChangeType::Added,
        old_path: None,
        additions: line_count,
        deletions: 0,
        is_binary: false,
        diff_content: Some(diff_content),
    })
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
pub(crate) fn parse_diff_output(output: &str) -> TaskDiff {
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

/// Execute git diff for uncommitted changes and parse output into structured diff data.
///
/// Computes the diff of staged + unstaged changes relative to HEAD, showing only
/// uncommitted changes (not committed changes on the branch). Also includes untracked
/// files as new files.
///
/// This is used for commit message generation, as opposed to `execute_diff()` which
/// shows all branch changes (for review context).
pub fn execute_uncommitted_diff(worktree_path: &Path) -> Result<TaskDiff, GitError> {
    // Get uncommitted tracked changes via git diff HEAD
    let output = Command::new("git")
        .args([
            "diff",
            "HEAD",
            "--unified=3",
            "--no-color",
            "--numstat",
            "--no-renames",
            "-p",
        ])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to execute git diff: {e}")))?;

    // Handle edge case: first commit on a branch (no HEAD yet)
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("unknown revision") || stderr.contains("bad revision") {
            // No HEAD ref yet — return empty diff gracefully
            // In practice, first commits use `git add -A` so there are always staged changes,
            // but we handle this edge case for correctness
            return Ok(TaskDiff { files: vec![] });
        }
        return Err(GitError::IoError(format!("git diff failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut task_diff = parse_diff_output(&stdout);

    // Add untracked files as new additions
    let untracked = get_untracked_files(worktree_path)?;
    for path in untracked {
        if let Some(file_diff) = create_untracked_file_diff(worktree_path, &path) {
            task_diff.files.push(file_diff);
        }
    }

    Ok(task_diff)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    /// Helper to set up a test git repo with a branch.
    fn setup_test_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        let path = dir.path();

        // Initialize repo
        Command::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .unwrap();

        // Configure git user for commits
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(path)
            .output()
            .unwrap();

        // Create initial commit on main
        fs::write(path.join("existing.txt"), "existing content\n").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(path)
            .output()
            .unwrap();

        // Create feature branch
        Command::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(path)
            .output()
            .unwrap();

        dir
    }

    #[test]
    fn test_untracked_files_appear_in_diff() {
        let dir = setup_test_repo();
        let path = dir.path();

        // Create untracked files
        fs::write(path.join("untracked1.txt"), "new content\n").unwrap();
        fs::write(path.join("untracked2.txt"), "more content\nline 2\n").unwrap();

        // Run execute_diff
        let result = execute_diff(path, "feature", "main").unwrap();

        // Should have both untracked files
        assert_eq!(result.files.len(), 2, "Expected 2 untracked files");

        let file1 = result.files.iter().find(|f| f.path == "untracked1.txt");
        let file2 = result.files.iter().find(|f| f.path == "untracked2.txt");

        assert!(file1.is_some(), "untracked1.txt should be in diff");
        assert!(file2.is_some(), "untracked2.txt should be in diff");

        let file1 = file1.unwrap();
        assert!(matches!(file1.change_type, FileChangeType::Added));
        assert_eq!(file1.additions, 1);
        assert!(!file1.is_binary);
        assert!(file1.diff_content.is_some());

        let file2 = file2.unwrap();
        assert!(matches!(file2.change_type, FileChangeType::Added));
        assert_eq!(file2.additions, 2);
    }

    #[test]
    fn test_tracked_and_untracked_files_combined() {
        let dir = setup_test_repo();
        let path = dir.path();

        // Modify tracked file
        fs::write(path.join("existing.txt"), "modified content\n").unwrap();

        // Create untracked file
        fs::write(path.join("new_file.txt"), "new file\n").unwrap();

        let result = execute_diff(path, "feature", "main").unwrap();

        // Should have both: 1 modified tracked + 1 untracked
        assert_eq!(result.files.len(), 2, "Expected 2 files total");

        let tracked = result.files.iter().find(|f| f.path == "existing.txt");
        let untracked = result.files.iter().find(|f| f.path == "new_file.txt");

        assert!(tracked.is_some(), "Modified tracked file should be in diff");
        assert!(untracked.is_some(), "Untracked file should be in diff");

        let tracked = tracked.unwrap();
        assert!(matches!(tracked.change_type, FileChangeType::Modified));

        let untracked = untracked.unwrap();
        assert!(matches!(untracked.change_type, FileChangeType::Added));
    }

    #[test]
    fn test_nested_untracked_files() {
        let dir = setup_test_repo();
        let path = dir.path();

        // Create nested directory with untracked file
        fs::create_dir_all(path.join("src/components")).unwrap();
        fs::write(
            path.join("src/components/Button.tsx"),
            "export const Button = () => {};\n",
        )
        .unwrap();

        let result = execute_diff(path, "feature", "main").unwrap();

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "src/components/Button.tsx");
        assert!(matches!(result.files[0].change_type, FileChangeType::Added));
    }

    /// Comprehensive test covering all change types: committed edits/deletes/creates
    /// plus uncommitted modifications and untracked new files.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn test_comprehensive_diff_all_change_types() {
        let dir = TempDir::new().unwrap();
        let path = dir.path();

        // Initialize repo with git config
        Command::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(path)
            .output()
            .unwrap();

        // === MAIN BRANCH: Create initial files ===
        fs::write(
            path.join("keep_unchanged.txt"),
            "this file stays the same\n",
        )
        .unwrap();
        fs::write(path.join("will_edit_committed.txt"), "original content\n").unwrap();
        fs::write(
            path.join("will_delete_committed.txt"),
            "this will be deleted\n",
        )
        .unwrap();
        fs::write(
            path.join("will_edit_uncommitted.txt"),
            "will be edited but not committed\n",
        )
        .unwrap();
        fs::write(
            path.join("will_delete_uncommitted.txt"),
            "will be deleted but not staged\n",
        )
        .unwrap();

        Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial commit with 5 files"])
            .current_dir(path)
            .output()
            .unwrap();

        // === FEATURE BRANCH ===
        Command::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(path)
            .output()
            .unwrap();

        // --- Committed changes ---
        // Edit a file
        fs::write(
            path.join("will_edit_committed.txt"),
            "edited content (committed)\n",
        )
        .unwrap();
        // Delete a file
        fs::remove_file(path.join("will_delete_committed.txt")).unwrap();
        // Create a new file
        fs::write(
            path.join("new_file_committed.txt"),
            "new file content\nline 2\n",
        )
        .unwrap();

        Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "committed changes: edit, delete, create"])
            .current_dir(path)
            .output()
            .unwrap();

        // --- Uncommitted changes (tracked) ---
        // Edit another file (not staged)
        fs::write(
            path.join("will_edit_uncommitted.txt"),
            "edited but not committed\n",
        )
        .unwrap();
        // Delete another file (not staged)
        fs::remove_file(path.join("will_delete_uncommitted.txt")).unwrap();

        // --- Untracked new files ---
        fs::write(path.join("untracked_new.txt"), "brand new untracked file\n").unwrap();
        fs::create_dir_all(path.join("new_dir")).unwrap();
        fs::write(
            path.join("new_dir/nested_untracked.txt"),
            "nested untracked\n",
        )
        .unwrap();

        // === Run diff ===
        let result = execute_diff(path, "feature", "main").unwrap();

        // === Verify results ===
        // Expected files:
        // 1. will_edit_committed.txt - Modified (committed edit)
        // 2. will_delete_committed.txt - Deleted (committed delete)
        // 3. new_file_committed.txt - Added (committed new file)
        // 4. will_edit_uncommitted.txt - Modified (uncommitted edit)
        // 5. will_delete_uncommitted.txt - Deleted (uncommitted delete)
        // 6. untracked_new.txt - Added (untracked)
        // 7. new_dir/nested_untracked.txt - Added (untracked nested)
        // keep_unchanged.txt should NOT appear (no changes)

        println!("Found {} files:", result.files.len());
        for f in &result.files {
            println!(
                "  - {} ({:?}, +{} -{}, binary={})",
                f.path, f.change_type, f.additions, f.deletions, f.is_binary
            );
        }

        assert_eq!(result.files.len(), 7, "Expected 7 changed files");

        // Verify each file
        let find_file = |name: &str| result.files.iter().find(|f| f.path == name);

        // Committed edit
        let edited_committed =
            find_file("will_edit_committed.txt").expect("will_edit_committed.txt missing");
        assert!(matches!(
            edited_committed.change_type,
            FileChangeType::Modified
        ));

        // Committed delete
        let deleted_committed =
            find_file("will_delete_committed.txt").expect("will_delete_committed.txt missing");
        assert!(matches!(
            deleted_committed.change_type,
            FileChangeType::Deleted
        ));

        // Committed new file
        let new_committed =
            find_file("new_file_committed.txt").expect("new_file_committed.txt missing");
        assert!(matches!(new_committed.change_type, FileChangeType::Added));
        assert_eq!(new_committed.additions, 2);

        // Uncommitted edit
        let edited_uncommitted =
            find_file("will_edit_uncommitted.txt").expect("will_edit_uncommitted.txt missing");
        assert!(matches!(
            edited_uncommitted.change_type,
            FileChangeType::Modified
        ));

        // Uncommitted delete
        let deleted_uncommitted =
            find_file("will_delete_uncommitted.txt").expect("will_delete_uncommitted.txt missing");
        assert!(matches!(
            deleted_uncommitted.change_type,
            FileChangeType::Deleted
        ));

        // Untracked files
        let untracked = find_file("untracked_new.txt").expect("untracked_new.txt missing");
        assert!(matches!(untracked.change_type, FileChangeType::Added));
        assert_eq!(untracked.additions, 1);

        let nested_untracked = find_file("new_dir/nested_untracked.txt")
            .expect("new_dir/nested_untracked.txt missing");
        assert!(matches!(
            nested_untracked.change_type,
            FileChangeType::Added
        ));

        // Unchanged file should NOT be present
        assert!(
            find_file("keep_unchanged.txt").is_none(),
            "Unchanged file should not appear in diff"
        );
    }

    /// Test that `execute_uncommitted_diff` only includes uncommitted changes,
    /// excluding committed changes on the branch.
    #[test]
    fn test_uncommitted_diff_excludes_committed_changes() {
        let dir = setup_test_repo();
        let path = dir.path();

        // === Committed changes on feature branch ===
        // Edit a file and commit it
        fs::write(path.join("existing.txt"), "committed change\n").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "committed edit"])
            .current_dir(path)
            .output()
            .unwrap();

        // Add a new file and commit it
        fs::write(path.join("committed_new.txt"), "new file committed\n").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "add new file"])
            .current_dir(path)
            .output()
            .unwrap();

        // === Uncommitted changes ===
        // Edit another file (unstaged)
        fs::write(path.join("uncommitted_edit.txt"), "uncommitted change\n").unwrap();

        // Create an untracked file
        fs::write(path.join("untracked.txt"), "untracked file\n").unwrap();

        // === Run execute_uncommitted_diff ===
        let result = execute_uncommitted_diff(path).unwrap();

        // === Verify results ===
        // Should ONLY have uncommitted changes, NOT committed changes
        assert_eq!(
            result.files.len(),
            2,
            "Expected 2 uncommitted files (1 edit + 1 untracked)"
        );

        let find_file = |name: &str| result.files.iter().find(|f| f.path == name);

        // Committed changes should NOT appear
        assert!(
            find_file("existing.txt").is_none(),
            "Committed edit should NOT be in uncommitted diff"
        );
        assert!(
            find_file("committed_new.txt").is_none(),
            "Committed new file should NOT be in uncommitted diff"
        );

        // Uncommitted changes SHOULD appear
        let uncommitted_edit =
            find_file("uncommitted_edit.txt").expect("Uncommitted edit should be in diff");
        assert!(matches!(
            uncommitted_edit.change_type,
            FileChangeType::Added
        ));

        let untracked = find_file("untracked.txt").expect("Untracked file should be in diff");
        assert!(matches!(untracked.change_type, FileChangeType::Added));
        assert_eq!(untracked.additions, 1);
    }
}
