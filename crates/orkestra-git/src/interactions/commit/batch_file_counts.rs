//! Batch file change counts for commits.

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Get file change counts for a batch of commit hashes.
pub fn execute(repo_path: &Path, hashes: &[String]) -> Result<HashMap<String, usize>, GitError> {
    let mut counts = HashMap::new();
    for hash in hashes {
        let output = Command::new("git")
            .args([
                "diff-tree",
                "--root",
                "--no-commit-id",
                "--name-only",
                "-r",
                hash,
            ])
            .current_dir(repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("git diff-tree: {e}")))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let count = stdout.lines().filter(|l| !l.is_empty()).count();
            counts.insert(hash.clone(), count);
        }
    }
    Ok(counts)
}
