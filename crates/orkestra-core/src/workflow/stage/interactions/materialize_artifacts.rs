//! Materialize task artifacts as files in the worktree.
//!
//! Writes all task artifacts to `.orkestra/.artifacts/{name}.md` before agent
//! spawn so agents can read them on demand instead of receiving them inline.
//! Always writes `trak.md` with task identity and description. Also writes
//! the activity log to `activity_log.md` when iteration entries or git commits exist.

use std::fmt::Write as _;
use std::fs;
use std::path::Path;

use orkestra_types::runtime::{
    artifact_file_path, artifacts_directory, ACTIVITY_LOG_ARTIFACT_NAME, TASK_ARTIFACT_NAME,
};

use crate::workflow::domain::Task;
use crate::workflow::stage::types::{ActivityEntry, ActivityLogEntry, CommitEntry};

/// Materialize all task artifacts and the activity log to the worktree.
///
/// Creates `.orkestra/.artifacts/` directory and writes each artifact as
/// `{name}.md`. Always writes `trak.md` with task identity metadata (not
/// included in returned names). When `activity_logs` is non-empty, writes
/// `activity_log.md` and includes `"activity_log"` in the returned names.
/// Overwrites existing files to ensure freshness.
///
/// Returns the list of materialized stage artifact names (for prompt building).
/// `trak.md` is excluded from the returned list — it is referenced directly
/// by the prompt template, not listed in the "Input Artifacts" section.
pub fn execute(task: &Task, activity_logs: &[ActivityLogEntry]) -> std::io::Result<Vec<String>> {
    let worktree_path = if let Some(p) = &task.worktree_path {
        Path::new(p)
    } else {
        debug_assert!(
            activity_logs.is_empty(),
            "activity logs present but no worktree to write them to"
        );
        return Ok(Vec::new());
    };

    // Gather all stage artifact names (trak.md is NOT included)
    let mut artifact_names: Vec<String> = task.artifacts.all().map(|a| a.name.clone()).collect();
    let has_activity_logs = !activity_logs.is_empty();

    // Create artifacts directory (always needed — trak.md is always written)
    let artifacts_dir = worktree_path.join(artifacts_directory());
    fs::create_dir_all(&artifacts_dir)
        .map_err(|e| std::io::Error::other(format!("{}: {}", artifacts_dir.display(), e)))?;

    // Always write trak.md (not included in returned artifact_names)
    let task_content = format_task_definition(task);
    let task_file_path = worktree_path.join(artifact_file_path(TASK_ARTIFACT_NAME));
    fs::write(&task_file_path, task_content)
        .map_err(|e| std::io::Error::other(format!("{}: {}", task_file_path.display(), e)))?;

    // Write regular artifacts
    for artifact in task.artifacts.all() {
        let file_path = worktree_path.join(artifact_file_path(&artifact.name));
        fs::write(&file_path, &artifact.content)
            .map_err(|e| std::io::Error::other(format!("{}: {}", file_path.display(), e)))?;
    }

    // Write activity log file (iterations + git commits merged chronologically)
    let commits = fetch_branch_commits(worktree_path, &task.base_branch);
    let has_timeline_content = has_activity_logs || !commits.is_empty();
    if has_timeline_content {
        let timeline = build_timeline(activity_logs, commits);
        let content = format_activity_log(&timeline);
        let file_path = worktree_path.join(artifact_file_path(ACTIVITY_LOG_ARTIFACT_NAME));
        fs::write(&file_path, content)
            .map_err(|e| std::io::Error::other(format!("{}: {}", file_path.display(), e)))?;
        artifact_names.push(ACTIVITY_LOG_ARTIFACT_NAME.to_string());
    }

    Ok(artifact_names)
}

// -- Helpers --

/// Format the task definition as a markdown file.
///
/// Produces a stable, human-readable file at `.orkestra/.artifacts/trak.md`
/// so agents can read task identity on demand rather than receiving it inline.
fn format_task_definition(task: &Task) -> String {
    format!(
        "**Trak ID**: {}\n**Title**: {}\n\n### Description\n{}",
        task.id, task.title, task.description
    )
}

/// Fetch git commits in the range `base_branch..HEAD` from the worktree.
///
/// Returns an empty vec on any failure (no git binary, invalid branch, no worktree),
/// preserving existing behavior of showing only iteration entries when commits can't be fetched.
fn fetch_branch_commits(worktree_path: &Path, base_branch: &str) -> Vec<CommitEntry> {
    if base_branch.is_empty() {
        return Vec::new();
    }
    let output = std::process::Command::new("git")
        .args([
            "log",
            "-200",
            "--format=%x1e%h%x00%s%x00%an%x00%aI",
            &format!("{base_branch}..HEAD"),
        ])
        .current_dir(worktree_path)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .split('\x1e')
        .filter_map(|record| {
            let record = record.trim();
            if record.is_empty() {
                return None;
            }
            let parts: Vec<&str> = record.splitn(4, '\0').collect();
            if parts.len() == 4 {
                Some(CommitEntry {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    author: parts[2].to_string(),
                    timestamp: parts[3].to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Merge iteration log entries and git commits into a single chronologically sorted timeline.
fn build_timeline(logs: &[ActivityLogEntry], commits: Vec<CommitEntry>) -> Vec<ActivityEntry> {
    let mut entries: Vec<ActivityEntry> = logs.iter().cloned().map(ActivityEntry::Log).collect();
    entries.extend(commits.into_iter().map(ActivityEntry::Commit));
    entries.sort_by(|a, b| a.sort_key().cmp(b.sort_key()));
    entries
}

/// Format a merged timeline of iteration entries and commits into markdown content.
///
/// Iteration entries: `[{stage}]\n{content}\n\n`
/// Commit entries: `> **[{hash}]** {message} — *{author}*\n\n`
fn format_activity_log(entries: &[ActivityEntry]) -> String {
    entries.iter().fold(String::new(), |mut s, entry| {
        match entry {
            ActivityEntry::Log(log) => {
                write!(s, "[{}]\n{}\n\n", log.stage, log.content)
                    .expect("write to String is infallible");
            }
            ActivityEntry::Commit(c) => {
                write!(s, "> **[{}]** {} — *{}*\n\n", c.hash, c.message, c.author)
                    .expect("write to String is infallible");
            }
        }
        s
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::Task;
    use orkestra_types::runtime::{Artifact, ACTIVITY_LOG_ARTIFACT_NAME};
    use tempfile::TempDir;

    fn make_log(
        stage: &str,
        iteration_number: u32,
        content: &str,
        timestamp: &str,
    ) -> ActivityLogEntry {
        ActivityLogEntry {
            stage: stage.to_string(),
            iteration_number,
            content: content.to_string(),
            timestamp: timestamp.to_string(),
        }
    }

    fn make_commit(hash: &str, message: &str, author: &str, timestamp: &str) -> CommitEntry {
        CommitEntry {
            hash: hash.to_string(),
            message: message.to_string(),
            author: author.to_string(),
            timestamp: timestamp.to_string(),
        }
    }

    #[test]
    fn test_no_worktree_returns_empty() {
        let task = Task::new("task-1", "Title", "Description", "work", "now");

        let result = execute(&task, &[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_empty_artifacts_writes_trak_md() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);

        let result = execute(&task, &[]).unwrap();
        // trak.md is not included in returned names
        assert!(result.is_empty());

        // Directory is created and trak.md is written even with no stage artifacts
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.exists());
        assert!(artifacts_dir.join("trak.md").exists());
    }

    #[test]
    fn test_trak_md_content_format() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let task = Task::new(
            "task-abc",
            "My Task Title",
            "A detailed description of the task.",
            "work",
            "now",
        )
        .with_worktree(worktree_path);

        execute(&task, &[]).unwrap();

        let trak_md =
            fs::read_to_string(temp_dir.path().join(".orkestra/.artifacts/trak.md")).unwrap();
        assert!(trak_md.contains("**Trak ID**: task-abc"));
        assert!(trak_md.contains("**Title**: My Task Title"));
        assert!(trak_md.contains("### Description"));
        assert!(trak_md.contains("A detailed description of the task."));
    }

    #[test]
    fn test_trak_md_not_in_returned_names() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));

        let result = execute(&task, &[]).unwrap();
        assert_eq!(result, vec!["plan"]);
        assert!(!result.contains(&"trak".to_string()));

        // trak.md is written but not returned
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.join("trak.md").exists());
        assert!(artifacts_dir.join("plan.md").exists());
    }

    #[test]
    fn test_materializes_single_artifact() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "The plan content", "planning", "now"));

        let result = execute(&task, &[]).unwrap();
        assert_eq!(result, vec!["plan"]);

        // Verify file was created with correct content
        let file_path = temp_dir.path().join(".orkestra/.artifacts/plan.md");
        assert!(file_path.exists());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "The plan content");
    }

    #[test]
    fn test_materializes_multiple_artifacts() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));
        task.artifacts.set(Artifact::new(
            "breakdown",
            "Breakdown content",
            "breakdown",
            "now",
        ));
        task.artifacts
            .set(Artifact::new("summary", "Summary content", "work", "now"));

        let result = execute(&task, &[]).unwrap();
        assert_eq!(result.len(), 3);
        assert!(result.contains(&"plan".to_string()));
        assert!(result.contains(&"breakdown".to_string()));
        assert!(result.contains(&"summary".to_string()));

        // Verify all files exist with correct content
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert_eq!(
            fs::read_to_string(artifacts_dir.join("plan.md")).unwrap(),
            "Plan content"
        );
        assert_eq!(
            fs::read_to_string(artifacts_dir.join("breakdown.md")).unwrap(),
            "Breakdown content"
        );
        assert_eq!(
            fs::read_to_string(artifacts_dir.join("summary.md")).unwrap(),
            "Summary content"
        );
    }

    #[test]
    fn test_overwrites_existing_files() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        // Pre-create artifacts directory with stale file
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        fs::create_dir_all(&artifacts_dir).unwrap();
        let file_path = artifacts_dir.join("plan.md");
        fs::write(&file_path, "Old content").unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "New content", "planning", "now"));

        let result = execute(&task, &[]).unwrap();
        assert_eq!(result, vec!["plan"]);

        // Verify file was overwritten
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "New content");
    }

    #[test]
    fn test_creates_nested_directory() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Content", "planning", "now"));

        // Directory doesn't exist yet
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(!artifacts_dir.exists());

        execute(&task, &[]).unwrap();

        // Directory should now exist
        assert!(artifacts_dir.exists());
    }

    #[test]
    fn test_error_propagates_for_invalid_worktree() {
        // Use a path that exists but where we can't create subdirectories
        // On Unix, /dev/null is a file, not a directory
        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree("/dev/null");
        task.artifacts
            .set(Artifact::new("plan", "content", "planning", "now"));

        let result = execute(&task, &[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_materializes_activity_log() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);

        let logs = vec![make_log(
            "work",
            1,
            "- Implemented the feature",
            "2024-01-01T10:00:00Z",
        )];

        let result = execute(&task, &logs).unwrap();
        assert_eq!(result, vec![ACTIVITY_LOG_ARTIFACT_NAME]);

        // Directory should be created
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.exists());

        // Activity log file should exist with correct content
        let file_path = artifacts_dir.join("activity_log.md");
        assert!(file_path.exists());
        assert_eq!(
            fs::read_to_string(&file_path).unwrap(),
            "[work]\n- Implemented the feature\n\n"
        );
    }

    #[test]
    fn test_activity_log_with_regular_artifacts() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));

        let logs = vec![make_log(
            "work",
            1,
            "- Did the work",
            "2024-01-01T10:00:00Z",
        )];

        let result = execute(&task, &logs).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.contains(&"plan".to_string()));
        assert!(result.contains(&ACTIVITY_LOG_ARTIFACT_NAME.to_string()));

        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.join("plan.md").exists());
        assert!(artifacts_dir.join("activity_log.md").exists());
    }

    #[test]
    fn test_empty_activity_logs_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));

        let result = execute(&task, &[]).unwrap();
        assert_eq!(result, vec!["plan"]);

        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.join("plan.md").exists());
        assert!(!artifacts_dir.join("activity_log.md").exists());
        assert!(!result.contains(&ACTIVITY_LOG_ARTIFACT_NAME.to_string()));
    }

    #[test]
    fn test_activity_log_format() {
        let entries = vec![
            ActivityEntry::Log(make_log("work", 1, "- Line one", "2024-01-01T10:00:00Z")),
            ActivityEntry::Log(make_log("review", 2, "- Line two", "2024-01-01T11:00:00Z")),
        ];

        let formatted = format_activity_log(&entries);
        assert_eq!(formatted, "[work]\n- Line one\n\n[review]\n- Line two\n\n");
    }

    #[test]
    fn test_commit_entry_format() {
        let entries = vec![ActivityEntry::Commit(make_commit(
            "abc1234",
            "Fix the bug",
            "Alice",
            "2024-01-01T10:00:00Z",
        ))];

        let formatted = format_activity_log(&entries);
        assert_eq!(formatted, "> **[abc1234]** Fix the bug — *Alice*\n\n");
    }

    #[test]
    fn test_interleaved_timeline() {
        let logs = vec![
            make_log("work", 1, "Implemented feature", "2024-01-01T09:00:00Z"),
            make_log("review", 2, "Approved", "2024-01-01T11:30:00Z"),
        ];
        let commits = vec![
            make_commit("abc1234", "Add tests", "Bob", "2024-01-01T10:00:00Z"),
            make_commit("def5678", "Refactor", "Bob", "2024-01-01T11:00:00Z"),
        ];

        let timeline = build_timeline(&logs, commits);
        let formatted = format_activity_log(&timeline);

        // Iteration at 09:00, commit at 10:00, commit at 11:00, iteration at 11:30
        assert!(formatted.contains("[work]\nImplemented feature"));
        assert!(formatted.contains("> **[abc1234]** Add tests — *Bob*"));
        assert!(formatted.contains("> **[def5678]** Refactor — *Bob*"));
        assert!(formatted.contains("[review]\nApproved"));

        let work_pos = formatted.find("[work]").unwrap();
        let commit1_pos = formatted.find("[abc1234]").unwrap();
        let commit2_pos = formatted.find("[def5678]").unwrap();
        let review_pos = formatted.find("[review]").unwrap();
        assert!(work_pos < commit1_pos);
        assert!(commit1_pos < commit2_pos);
        assert!(commit2_pos < review_pos);
    }

    #[test]
    fn test_build_timeline_sorts_chronologically() {
        let logs = vec![make_log("work", 1, "content", "2024-01-01T12:00:00Z")];
        let commits = vec![make_commit("aaa", "early", "A", "2024-01-01T08:00:00Z")];

        let timeline = build_timeline(&logs, commits);
        assert_eq!(timeline.len(), 2);
        // commit (08:00) sorts before log (12:00)
        assert!(matches!(timeline[0], ActivityEntry::Commit(_)));
        assert!(matches!(timeline[1], ActivityEntry::Log(_)));
    }

    #[test]
    fn test_empty_base_branch_skips_commits() {
        let temp_dir = TempDir::new().unwrap();
        let commits = fetch_branch_commits(temp_dir.path(), "");
        assert!(commits.is_empty());
    }

    #[test]
    fn test_commits_only_timeline() {
        let commits = vec![make_commit("abc", "msg", "author", "2024-01-01T10:00:00Z")];
        let timeline = build_timeline(&[], commits);
        let formatted = format_activity_log(&timeline);
        assert_eq!(formatted, "> **[abc]** msg — *author*\n\n");
    }
}
