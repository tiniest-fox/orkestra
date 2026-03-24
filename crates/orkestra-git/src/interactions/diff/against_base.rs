//! Diff worktree against base branch.

use std::path::Path;

use crate::types::{GitError, TaskDiff};

/// Get the diff between a task branch and its base branch.
///
/// Uses `git diff --merge-base` to compute the diff, plus untracked files.
pub fn execute(
    worktree_path: &Path,
    _branch_name: &str,
    base_branch: &str,
    context_lines: u32,
) -> Result<TaskDiff, GitError> {
    let mut diff = super::collect::execute(
        worktree_path,
        &[
            "diff",
            "--merge-base",
            base_branch,
            &format!("--unified={context_lines}"),
            "--no-color",
            "--numstat",
            "--no-renames",
            "-p",
        ],
    )?;
    for file in &mut diff.files {
        if file.is_binary || file.change_type == crate::types::FileChangeType::Deleted {
            continue;
        }
        let full_path = worktree_path.join(&file.path);
        if let Ok(content) = std::fs::read(&full_path) {
            #[allow(clippy::naive_bytecount)]
            let newlines = content.iter().filter(|&&b| b == b'\n').count();
            let total = if !content.is_empty() && content.last() != Some(&b'\n') {
                newlines + 1
            } else {
                newlines
            };
            #[allow(clippy::cast_possible_truncation)]
            let total_u32 = total as u32;
            file.total_new_lines = Some(total_u32);
        }
    }
    Ok(diff)
}
