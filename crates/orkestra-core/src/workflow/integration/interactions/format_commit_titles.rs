//! Format commit log entries as title-only summaries for PR generation orientation.

use std::fmt::Write;
use std::path::Path;

use crate::workflow::ports::GitService;

/// Format recent commit titles from a worktree into a prompt-ready summary.
///
/// Retrieves up to `limit` commits and formats each as a one-liner (hash + title only).
/// Used by PR creation to give the agent orientation before it explores further with tools.
pub(crate) fn execute(git: &dyn GitService, worktree_path: &Path, limit: usize) -> String {
    match git.commit_log_at(worktree_path, limit) {
        Ok(commits) if !commits.is_empty() => {
            let mut summary = String::new();
            for commit in &commits {
                let _ = writeln!(summary, "- {} {}", commit.hash, commit.message);
            }
            summary
        }
        _ => "Commit log unavailable".to_string(),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::path::Path;

    use orkestra_git::{CommitInfo, MockGitService};

    fn commit(hash: &str, message: &str, body: Option<&str>) -> CommitInfo {
        CommitInfo {
            hash: hash.to_string(),
            message: message.to_string(),
            body: body.map(std::string::ToString::to_string),
            author: "Test Author".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            file_count: None,
        }
    }

    #[test]
    fn multiple_commits() {
        let mock = MockGitService::new();
        mock.push_commit_log_at_result(Ok(vec![
            commit("abc1234", "feat: add feature A", None),
            commit(
                "def5678",
                "fix: correct bug B",
                Some("body text that should be omitted"),
            ),
        ]));

        let result = super::execute(&mock, Path::new("/fake"), 10);

        assert!(result.contains("- abc1234 feat: add feature A"));
        assert!(result.contains("- def5678 fix: correct bug B"));
        // Bodies must NOT appear
        assert!(!result.contains("body text that should be omitted"));
    }

    #[test]
    fn empty_list_returns_fallback() {
        let mock = MockGitService::new();
        // Default MockGitService returns Ok(vec![]) for commit_log_at — no queue entry needed

        let result = super::execute(&mock, Path::new("/fake"), 10);

        assert_eq!(result, "Commit log unavailable");
    }

    #[test]
    fn git_error_returns_fallback() {
        let mock = MockGitService::new();
        mock.push_commit_log_at_result(Err(orkestra_git::GitError::Other(
            "simulated error".to_string(),
        )));

        let result = super::execute(&mock, Path::new("/fake"), 10);

        assert_eq!(result, "Commit log unavailable");
    }
}
