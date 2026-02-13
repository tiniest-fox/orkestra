//! Worktree commit utilities.
//!
//! Standalone functions for committing changes in task worktrees and generating
//! commit messages. Extracted from scattered logic across `integration.rs`,
//! `orchestrator.rs`, and `api.rs` to provide a single source of truth.
//!
//! # Commit Message Strategy
//!
//! Per-stage commits use simple deterministic messages: `{stage}: {task_id}` with
//! the iteration's `activity_log` as the body. LLM-generated commit messages are
//! reserved for the final squash during integration.

use std::path::Path;

use crate::commit_message::{collect_model_names, fallback_commit_message, CommitMessageGenerator};
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{FileChangeType, GitError, GitService};

/// Commit any uncommitted changes in a task's worktree with a simple stage-based message.
///
/// No-op if the task has no worktree, the worktree doesn't exist, or there are
/// no uncommitted changes (handled by `commit_pending_changes`).
///
/// Uses simple deterministic messages (`{stage}: {task_id}`) instead of LLM generation.
/// The `activity_log` from the iteration is included as the commit body.
pub(crate) fn commit_worktree_changes(
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

/// Format a simple commit message for per-stage commits.
///
/// Format: `{stage}: {task_id}\n\n{activity_log or fallback}`
///
/// Used during the normal workflow pipeline. LLM-generated messages
/// are reserved for the squash commit during integration.
pub(crate) fn format_simple_commit_message(
    task_id: &str,
    stage: &str,
    activity_log: Option<&str>,
) -> String {
    let body = activity_log.unwrap_or("No activity log recorded.");
    format!("{stage}: {task_id}\n\n{body}")
}

// ============================================================================
// LLM-based commit messages (for integration squash)
// ============================================================================

/// Generate a commit message for a task using AI with fallback to task title.
///
/// Uses uncommitted changes diff. For squash commits during integration,
/// use `generate_squash_commit_message` instead which uses committed changes.
pub(crate) fn generate_task_commit_message(
    git: &dyn GitService,
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
) -> String {
    let diff_summary = build_diff_summary(git, task);
    generate_with_fallback(task, workflow, commit_gen, &diff_summary)
}

/// Generate a squash commit message for integration using all committed changes.
///
/// Used during integration to create a single squash commit with an AI-generated
/// summary of all changes on the branch. Unlike `generate_task_commit_message`,
/// this uses `build_committed_diff_summary` which shows all committed changes
/// between the branch and its merge-base, not just uncommitted changes.
pub(crate) fn generate_squash_commit_message(
    git: &dyn GitService,
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
) -> String {
    let diff_summary = build_committed_diff_summary(git, task);
    generate_with_fallback(task, workflow, commit_gen, &diff_summary)
}

/// Generate a commit message for a task without git diff information.
///
/// Used when no git service is available (e.g., tests, no-worktree scenarios).
/// Still uses the full commit message pipeline (model attribution, Orkestra branding)
/// but passes a placeholder instead of a real diff summary.
///
/// For integration squash — per-stage commits use `format_simple_commit_message`.
pub(crate) fn generate_task_commit_message_without_diff(
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
) -> String {
    generate_with_fallback(task, workflow, commit_gen, "No git diff available")
}

/// Generate commit message via AI, falling back to task title on failure.
fn generate_with_fallback(
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
    diff_summary: &str,
) -> String {
    let model_names = collect_model_names(workflow, task.flow.as_deref());

    match commit_gen.generate_commit_message(
        &task.title,
        &task.description,
        diff_summary,
        &model_names,
    ) {
        Ok(message) => message,
        Err(e) => {
            crate::orkestra_debug!(
                "commit",
                "Commit message generation failed for {}: {e}, using fallback",
                task.id
            );
            fallback_commit_message(&task.title, &task.id)
        }
    }
}

/// Build a diff summary string from a task's uncommitted worktree changes.
pub(crate) fn build_diff_summary(git: &dyn GitService, task: &Task) -> String {
    let Some(worktree_path) = &task.worktree_path else {
        return String::from("No worktree");
    };

    match git.diff_uncommitted(Path::new(worktree_path)) {
        Ok(diff) => format_diff_summary(&diff),
        Err(e) => {
            crate::orkestra_debug!("commit", "Failed to get diff for commit message: {e}");
            String::from("Diff unavailable")
        }
    }
}

/// Build a diff summary string from a task's committed changes (all commits on branch).
///
/// Used for squash commit message generation, where we need to summarize all committed
/// changes on the branch, not just uncommitted changes.
pub(crate) fn build_committed_diff_summary(git: &dyn GitService, task: &Task) -> String {
    let Some(worktree_path) = &task.worktree_path else {
        return String::from("No worktree");
    };
    let Some(branch_name) = &task.branch_name else {
        return String::from("No branch");
    };

    match git.diff_against_base(Path::new(worktree_path), branch_name, &task.base_branch) {
        Ok(diff) => format_diff_summary(&diff),
        Err(e) => {
            crate::orkestra_debug!(
                "commit",
                "Failed to get committed diff for commit message: {e}"
            );
            String::from("Diff unavailable")
        }
    }
}

/// Format a `TaskDiff` into a human-readable summary.
fn format_diff_summary(diff: &crate::workflow::ports::TaskDiff) -> String {
    use std::fmt::Write;

    let mut summary = String::new();
    for file in &diff.files {
        let change = match file.change_type {
            FileChangeType::Added => "added",
            FileChangeType::Modified => "modified",
            FileChangeType::Deleted => "deleted",
            FileChangeType::Renamed => "renamed",
        };
        let _ = writeln!(
            summary,
            "- {} ({}, +{} -{})",
            file.path, change, file.additions, file.deletions
        );
    }
    if summary.is_empty() {
        "No file changes detected".to_string()
    } else {
        summary
    }
}

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
