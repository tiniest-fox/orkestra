//! Format commit log entries into a human-readable summary for AI prompts.

use std::fmt::Write;
use std::path::Path;

use crate::workflow::ports::GitService;

/// Format recent commit messages from a worktree into a prompt-ready summary.
///
/// Retrieves up to `limit` commits and formats each as a one-liner with optional
/// truncated body. Used by both PR creation and PR audit flows.
pub(crate) fn execute(git: &dyn GitService, worktree_path: &Path, limit: usize) -> String {
    match git.commit_log_at(worktree_path, limit) {
        Ok(commits) if !commits.is_empty() => {
            let mut summary = String::new();
            for commit in &commits {
                let _ = writeln!(summary, "- {} {}", commit.hash, commit.message);
                if let Some(body) = &commit.body {
                    let truncated = if body.len() > 200 {
                        let mut end = 200;
                        while !body.is_char_boundary(end) {
                            end -= 1;
                        }
                        &body[..end]
                    } else {
                        body
                    };
                    let _ = writeln!(summary, "  {truncated}");
                }
            }
            summary
        }
        _ => "Commit log unavailable".to_string(),
    }
}
