//! Commit pending worktree changes with an LLM-generated or simple stage-based message.

use std::path::Path;

use crate::commit_message::CommitMessageGenerator;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitError, GitService};

/// Commit any uncommitted changes in a task's worktree.
///
/// No-op if the task has no worktree, the worktree doesn't exist, or there are
/// no uncommitted changes (handled by `commit_pending_changes`).
///
/// When `llm` deps are provided, attempts LLM-generated commit messages (using
/// uncommitted diff), falling back to the title-based format on failure. When
/// `llm` is `None` (e.g., safety-net commits during integration), uses the
/// simple deterministic `{stage}: {task_id}` format.
pub(crate) fn execute(
    git: &dyn GitService,
    task: &Task,
    stage: &str,
    activity_log: Option<&str>,
    llm: Option<(&dyn CommitMessageGenerator, &WorkflowConfig)>,
) -> Result<(), GitError> {
    let Some(worktree_path) = &task.worktree_path else {
        return Ok(());
    };
    let worktree = Path::new(worktree_path);
    if !worktree.exists() {
        crate::orkestra_debug!(
            "commit",
            "WARNING: worktree missing for task {} at {}, skipping commit",
            task.id,
            worktree_path
        );
        return Ok(());
    }

    if !git.has_pending_changes(worktree)? {
        return Ok(());
    }

    let message = build_commit_message(git, task, stage, activity_log, llm);
    git.commit_pending_changes(worktree, &message)
}

// -- Helpers --

/// Build a commit message, attempting LLM generation when deps are provided.
///
/// Falls back to the simple `{stage}: {task_id}` format when LLM deps are not
/// provided (safety-net commit path). When deps are provided and LLM fails,
/// `generate_commit_message::execute` falls back to the title-based format.
fn build_commit_message(
    git: &dyn GitService,
    task: &Task,
    stage: &str,
    activity_log: Option<&str>,
    llm: Option<(&dyn CommitMessageGenerator, &WorkflowConfig)>,
) -> String {
    match llm {
        Some((gen, wf)) => super::generate_commit_message::execute(git, task, wf, gen),
        None => format_simple_commit_message(&task.id, stage, activity_log),
    }
}

/// Format a simple commit message for per-stage commits.
///
/// Format: `{stage}: {task_id}\n\n{activity_log or fallback}`
fn format_simple_commit_message(task_id: &str, stage: &str, activity_log: Option<&str>) -> String {
    let body = activity_log.unwrap_or("No activity log recorded.");
    format!("{stage}: {task_id}\n\n{body}")
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::Task;
    use crate::workflow::ports::MockGitService;

    fn make_task(worktree_path: Option<&str>) -> Task {
        let mut task = Task::new(
            "task-test",
            "Test task",
            "Test description",
            "work",
            "2024-01-01T00:00:00Z",
        );
        task.worktree_path = worktree_path.map(String::from);
        task
    }

    #[test]
    fn test_format_simple_commit_message_with_activity_log() {
        let message = format_simple_commit_message(
            "task-123",
            "work",
            Some("- Implemented the new feature\n- Added tests"),
        );

        assert_eq!(
            message,
            "work: task-123\n\n- Implemented the new feature\n- Added tests"
        );
    }

    #[test]
    fn test_format_simple_commit_message_without_activity_log() {
        let message = format_simple_commit_message("task-456", "planning", None);

        assert_eq!(message, "planning: task-456\n\nNo activity log recorded.");
    }

    #[test]
    fn test_format_simple_commit_message_integrating_phase() {
        // Safety-net commits during integration use the phase name
        let message = format_simple_commit_message("task-789", "integrating", None);

        assert_eq!(
            message,
            "integrating: task-789\n\nNo activity log recorded."
        );
    }

    #[test]
    fn test_execute_no_worktree_is_noop() {
        let git = MockGitService::new();
        let task = make_task(None);

        let result = execute(&git, &task, "work", None, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_execute_no_pending_changes_is_noop() {
        // has_pending_changes returns false by default — execute is a no-op.
        let git = MockGitService::new();
        let task = make_task(Some("/tmp"));

        let result = execute(&git, &task, "integrating", None, None);
        assert!(result.is_ok());
    }

    #[cfg(feature = "testutil")]
    #[test]
    fn test_execute_llm_success_uses_llm_message() {
        use std::sync::Arc;

        use tempfile::TempDir;

        use crate::commit_message::mock::MockCommitMessageGenerator;
        use crate::workflow::config::WorkflowConfig;

        let tmp = TempDir::new().unwrap();
        let worktree_path = tmp.path().to_str().unwrap().to_string();

        let git = MockGitService::new();
        git.set_has_pending_changes(true);

        let task = make_task(Some(&worktree_path));
        let gen = Arc::new(MockCommitMessageGenerator::succeeding());
        let workflow = WorkflowConfig::new(vec![]);

        let result = execute(
            &git,
            &task,
            "work",
            Some("log"),
            Some((gen.as_ref(), &workflow)),
        );
        assert!(result.is_ok());
    }

    #[cfg(feature = "testutil")]
    #[test]
    fn test_execute_llm_failure_falls_back_to_title_format() {
        use std::sync::Arc;

        use tempfile::TempDir;

        use crate::commit_message::mock::MockCommitMessageGenerator;
        use crate::workflow::config::WorkflowConfig;

        let tmp = TempDir::new().unwrap();
        let worktree_path = tmp.path().to_str().unwrap().to_string();

        let git = MockGitService::new();
        git.set_has_pending_changes(true);

        let task = make_task(Some(&worktree_path));
        let gen = Arc::new(MockCommitMessageGenerator::failing());
        let workflow = WorkflowConfig::new(vec![]);

        // Failing generator should fall back without error
        let result = execute(
            &git,
            &task,
            "work",
            Some("log"),
            Some((gen.as_ref(), &workflow)),
        );
        assert!(result.is_ok());
    }
}
