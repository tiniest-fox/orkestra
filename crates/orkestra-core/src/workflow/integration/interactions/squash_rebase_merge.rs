//! Git integration pipeline: safety-net commit, squash, sync merge, AI message, merge to target.

use std::path::{Path, PathBuf};

use crate::commit_message::fallback_commit_message;
use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitError, GitService};
use crate::CommitMessageGenerator;

use super::super::service::IntegrationGitResult;

/// Parameters needed to perform the merge step.
struct IntegrationParams<'a> {
    task_id: String,
    branch_name: String,
    target_branch: String,
    worktree_path: Option<PathBuf>,
    task: &'a Task,
    workflow: &'a WorkflowConfig,
    commit_message_generator: &'a dyn CommitMessageGenerator,
}

/// Safety-net commit → squash (top-level only) → sync merge → AI message → merge to target.
///
/// Pure git work — no API lock needed. Returns an `IntegrationGitResult` that
/// the caller records via `apply_integration_result` (sync) or `record_result` (background).
///
/// Commit message generation is deferred until after the sync merge succeeds to avoid
/// wasting an AI call when merge conflicts would cause integration to fail anyway.
pub(crate) fn execute(
    git: &dyn GitService,
    task: &Task,
    workflow: &WorkflowConfig,
    commit_message_generator: &dyn CommitMessageGenerator,
) -> IntegrationGitResult {
    let task_id = &task.id;

    if task.base_branch.is_empty() {
        return IntegrationGitResult::CommitError(format!(
            "Task {} has no base_branch set — cannot determine merge target",
            task.id
        ));
    }

    let Some(branch_name) = task.branch_name.clone() else {
        return IntegrationGitResult::CommitError(format!(
            "Task {} has no branch_name — cannot integrate",
            task.id
        ));
    };

    // Safety-net commit — should be a no-op after the Finishing pipeline,
    // but catches stragglers from manual recovery or direct API calls.
    if let Err(e) = super::commit_worktree::execute(git, task, "integrating", None, None) {
        let error_msg = format!("Failed to commit pending changes: {e}");
        orkestra_debug!(
            "integration",
            "safety-net commit failed for {}: {}",
            task_id,
            error_msg
        );
        return IntegrationGitResult::CommitError(error_msg);
    }

    // Squash commits for top-level tasks (subtasks keep individual commits).
    // The squash commit uses a simple fallback message — the AI-generated message
    // goes on the merge commit created on the target branch by merge_to_branch.
    if task.parent_id.is_none() {
        if let Some(worktree_path) = &task.worktree_path {
            let squash_message = fallback_commit_message(&task.title, &task.id);
            match git.squash_commits(Path::new(worktree_path), &task.base_branch, &squash_message) {
                Ok(squashed) => {
                    if squashed {
                        orkestra_debug!("integration", "squashed commits for task {}", task_id);
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to squash commits: {e}");
                    orkestra_debug!(
                        "integration",
                        "squash failed for {}: {}",
                        task_id,
                        error_msg
                    );
                    return IntegrationGitResult::CommitError(error_msg);
                }
            }
        }
    }

    // Sync base branch from remote (skip for subtask branches on parent's local branch)
    if !task.base_branch.starts_with("task/") {
        if let Err(e) = git.sync_base_branch(&task.base_branch) {
            orkestra_debug!(
                "integration",
                "failed to sync {} before rebase for {}: {} (continuing anyway)",
                task.base_branch,
                task_id,
                e
            );
        } else {
            orkestra_debug!(
                "integration",
                "synced {} from remote before rebase for {}",
                task.base_branch,
                task_id
            );
        }
    }

    let params = IntegrationParams {
        task_id: task_id.clone(),
        branch_name,
        target_branch: task.base_branch.clone(),
        worktree_path: task.worktree_path.as_ref().map(PathBuf::from),
        task,
        workflow,
        commit_message_generator,
    };

    perform_git_integration(git, &params)
}

// -- Helpers --

/// Sync merge into worktree, generate AI commit message, then merge to target branch.
///
/// Commit message generation happens after the sync merge succeeds — if the sync
/// merge hits a conflict, we bail early without wasting an AI call.
fn perform_git_integration(
    git: &dyn GitService,
    params: &IntegrationParams<'_>,
) -> IntegrationGitResult {
    // Merge target branch into the task branch, leaving conflict markers in place on failure.
    if let Some(worktree_path) = &params.worktree_path {
        let worktree = Path::new(worktree_path);
        if worktree.exists() {
            match git.merge_into_worktree(worktree, &params.target_branch) {
                Ok(()) => {
                    orkestra_debug!(
                        "integration",
                        "merged {}: {} into task branch",
                        params.task_id,
                        params.target_branch
                    );
                }
                Err(GitError::MergeConflict { conflict_files, .. }) => {
                    orkestra_debug!(
                        "integration",
                        "failed {}: merge conflict, {} files",
                        params.task_id,
                        conflict_files.len()
                    );
                    return IntegrationGitResult::RebaseConflict { conflict_files };
                }
                Err(e) => {
                    orkestra_debug!(
                        "integration",
                        "failed {}: merge error: {}",
                        params.task_id,
                        e
                    );
                    return IntegrationGitResult::RebaseError(format!(
                        "Failed to merge {} into task branch: {e}",
                        params.target_branch
                    ));
                }
            }
        } else {
            orkestra_debug!(
                "integration",
                "worktree missing for {}, skipping merge",
                params.task_id
            );
        }
    }

    // Check if the task branch has actual changes relative to the target.
    // If there's nothing to merge (e.g., task made no file modifications),
    // skip AI message generation and use a plain fast-forward merge.
    let has_changes = params.worktree_path.as_ref().is_some_and(|wp| {
        git.diff_against_base(Path::new(wp), &params.branch_name, &params.target_branch)
            .is_ok_and(|diff| !diff.files.is_empty())
    });

    if !has_changes {
        orkestra_debug!(
            "integration",
            "no changes for {}, skipping AI message generation",
            params.task_id
        );
        // Fast-forward merge (no-op for up-to-date branches)
        match git.merge_to_branch(&params.branch_name, &params.target_branch, None) {
            Ok(_) => {}
            Err(e) => {
                orkestra_debug!("integration", "failed {}: {}", params.task_id, e);
                return IntegrationGitResult::MergeError(format!("{e}"));
            }
        }
        // Push the target branch to remote (skip for subtask branches)
        if !params.target_branch.starts_with("task/") {
            if let Err(e) = git.push_branch(&params.target_branch) {
                orkestra_debug!(
                    "integration",
                    "failed to push {} after merge for {}: {} (continuing anyway)",
                    params.target_branch,
                    params.task_id,
                    e
                );
            }
        }
        return IntegrationGitResult::Success;
    }

    // Generate AI commit message now that sync merge has succeeded (no conflict).
    // This message goes on the merge commit created on the target branch.
    let commit_message = super::generate_commit_message::execute_for_squash(
        git,
        params.task,
        params.workflow,
        params.commit_message_generator,
    );

    // Merge to target branch with the AI-generated message (--no-ff).
    match git.merge_to_branch(
        &params.branch_name,
        &params.target_branch,
        Some(&commit_message),
    ) {
        Ok(_merge_result) => {
            orkestra_debug!(
                "integration",
                "completed {}: merge succeeded",
                params.task_id
            );

            // Push updated base branch to remote (skip for subtask branches)
            if !params.target_branch.starts_with("task/") {
                if let Err(e) = git.push_branch(&params.target_branch) {
                    orkestra_debug!(
                        "integration",
                        "failed to push {} after merge for {}: {} (continuing anyway)",
                        params.target_branch,
                        params.task_id,
                        e
                    );
                } else {
                    orkestra_debug!(
                        "integration",
                        "pushed {} to remote after merge for {}",
                        params.target_branch,
                        params.task_id
                    );
                }
            }

            IntegrationGitResult::Success
        }
        Err(e) => {
            orkestra_debug!("integration", "failed {}: {}", params.task_id, e);
            IntegrationGitResult::MergeError(format!("{e}"))
        }
    }
}
