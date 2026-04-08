//! Format commit log entries into a human-readable summary for AI prompts.

use std::fmt::Write;
use std::path::Path;

use crate::workflow::ports::GitService;

/// Format recent commit messages from a worktree into a prompt-ready summary.
///
/// Retrieves up to `limit` commits and formats each as a one-liner with optional
/// truncated body. Used by the PR audit flow to provide commit context for description updates.
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
    fn multiple_commits_no_body() {
        let mock = MockGitService::new();
        mock.push_commit_log_at_result(Ok(vec![
            commit("abc1234", "feat: add feature A", None),
            commit("def5678", "fix: correct bug B", None),
        ]));

        let result = super::execute(&mock, Path::new("/fake"), 10);

        assert!(result.contains("- abc1234 feat: add feature A"));
        assert!(result.contains("- def5678 fix: correct bug B"));
    }

    #[test]
    fn commit_with_short_body() {
        let mock = MockGitService::new();
        mock.push_commit_log_at_result(Ok(vec![commit(
            "abc1234",
            "feat: add feature",
            Some("short body text"),
        )]));

        let result = super::execute(&mock, Path::new("/fake"), 10);

        assert!(result.contains("- abc1234 feat: add feature"));
        assert!(result.contains("  short body text"));
    }

    #[test]
    fn commit_with_long_body_truncated() {
        let long_body: String = "x".repeat(300);
        let mock = MockGitService::new();
        mock.push_commit_log_at_result(Ok(vec![commit(
            "abc1234",
            "feat: something",
            Some(&long_body),
        )]));

        let result = super::execute(&mock, Path::new("/fake"), 10);

        // The body should appear but be truncated to ≤200 chars
        let body_line = result
            .lines()
            .find(|l| l.starts_with("  "))
            .expect("body line missing");
        assert!(body_line.trim().len() <= 200);
    }

    #[test]
    fn body_truncation_at_utf8_boundary() {
        // 199 ASCII bytes + a 2-byte UTF-8 char (é = 0xC3 0xA9) → boundary at 200 would split it
        let mut body = "a".repeat(199);
        body.push('é'); // 2-byte char, so body is 201 bytes total
        body.push_str("trailing text");

        let mock = MockGitService::new();
        mock.push_commit_log_at_result(Ok(vec![commit("abc1234", "chore: test", Some(&body))]));

        let result = super::execute(&mock, Path::new("/fake"), 10);

        let body_line = result
            .lines()
            .find(|l| l.starts_with("  "))
            .expect("body line missing");
        // Must be valid UTF-8 (no panic) and ≤200 chars
        let trimmed = body_line.trim();
        assert!(trimmed.len() <= 200);
        // The 'é' should be excluded (boundary lands before it)
        assert!(!trimmed.contains('é'));
    }

    #[test]
    fn empty_commit_list_returns_fallback() {
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
