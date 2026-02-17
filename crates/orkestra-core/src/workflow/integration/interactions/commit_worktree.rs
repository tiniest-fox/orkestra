//! Commit pending worktree changes with a simple stage-based message.

use std::path::Path;

use crate::workflow::domain::Task;
use crate::workflow::ports::{GitError, GitService};

/// Commit any uncommitted changes in a task's worktree with a simple stage-based message.
///
/// No-op if the task has no worktree, the worktree doesn't exist, or there are
/// no uncommitted changes (handled by `commit_pending_changes`).
///
/// Uses simple deterministic messages (`{stage}: {task_id}`) instead of LLM generation.
/// The `activity_log` from the iteration is included as the commit body.
pub(crate) fn execute(
    git: &dyn GitService,
    task: &Task,
    stage: &str,
    activity_log: Option<&str>,
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

    let message = format_simple_commit_message(&task.id, stage, activity_log);
    git.commit_pending_changes(worktree, &message)
}

// -- Helpers --

/// Format a simple commit message for per-stage commits.
///
/// Format: `{stage}: {task_id}\n\n{activity_log or fallback}`
///
/// Used during the normal workflow pipeline. LLM-generated messages
/// are reserved for the squash commit during integration.
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
}
