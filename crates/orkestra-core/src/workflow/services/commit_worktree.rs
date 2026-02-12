//! Worktree commit utilities.
//!
//! Standalone functions for committing changes in task worktrees and generating
//! commit messages. Extracted from scattered logic across `integration.rs`,
//! `orchestrator.rs`, and `api.rs` to provide a single source of truth.

use std::path::Path;

use crate::commit_message::{collect_model_names, fallback_commit_message, CommitMessageGenerator};
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{FileChangeType, GitError, GitService};

/// Commit any uncommitted changes in a task's worktree with an AI-generated message.
///
/// No-op if the task has no worktree, the worktree doesn't exist, or there are
/// no uncommitted changes (handled by `commit_pending_changes`).
pub(crate) fn commit_worktree_changes(
    git: &dyn GitService,
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
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

    let message = generate_task_commit_message(git, task, workflow, commit_gen);
    git.commit_pending_changes(worktree, &message)
}

/// Generate a commit message for a task using AI with fallback to task title.
pub(crate) fn generate_task_commit_message(
    git: &dyn GitService,
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
) -> String {
    let diff_summary = build_diff_summary(git, task);
    generate_with_fallback(task, workflow, commit_gen, &diff_summary)
}

/// Generate a commit message for a task without git diff information.
///
/// Used when no git service is available (e.g., tests, no-worktree scenarios).
/// Still uses the full commit message pipeline (model attribution, Orkestra branding)
/// but passes a placeholder instead of a real diff summary.
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

/// Build a diff summary string from a task's worktree changes.
fn build_diff_summary(git: &dyn GitService, task: &Task) -> String {
    use std::fmt::Write;

    let Some(worktree_path) = &task.worktree_path else {
        return String::from("No worktree");
    };

    match git.diff_uncommitted(Path::new(worktree_path)) {
        Ok(diff) => {
            let mut summary = String::new();
            for file in &diff.files {
                let change = match file.change_type {
                    FileChangeType::Added => "added",
                    FileChangeType::Modified => "modified",
                    FileChangeType::Deleted => "deleted",
                    FileChangeType::Renamed => "renamed",
                };
                writeln!(
                    summary,
                    "- {} ({}, +{} -{})",
                    file.path, change, file.additions, file.deletions
                )
                .unwrap();
            }
            if summary.is_empty() {
                "No file changes detected".to_string()
            } else {
                summary
            }
        }
        Err(e) => {
            crate::orkestra_debug!("commit", "Failed to get diff for commit message: {e}");
            String::from("Diff unavailable")
        }
    }
}
