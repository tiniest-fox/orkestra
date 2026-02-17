//! Git integration pipeline: safety-net commit, squash, rebase, merge.

use std::path::{Path, PathBuf};

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitError, GitService};
use crate::CommitMessageGenerator;

use super::super::service::IntegrationGitResult;

/// Parameters needed to perform the rebase + merge step.
struct IntegrationParams {
    task_id: String,
    branch_name: String,
    target_branch: String,
    worktree_path: Option<PathBuf>,
}

/// Safety-net commit → squash (top-level only) → rebase → merge.
///
/// Pure git work — no API lock needed. Returns an `IntegrationGitResult` that
/// the caller records via `apply_integration_result` (sync) or `record_result` (background).
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

    // Safety-net commit — should be a no-op after the Finishing pipeline,
    // but catches stragglers from manual recovery or direct API calls.
    if let Err(e) = super::commit_worktree::execute(git, task, "integrating", None) {
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
    if task.parent_id.is_none() {
        if let Some(worktree_path) = &task.worktree_path {
            let squash_message = super::generate_commit_message::execute_for_squash(
                git,
                task,
                workflow,
                commit_message_generator,
            );
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

    let Some(branch_name) = task.branch_name.clone() else {
        return IntegrationGitResult::CommitError(format!(
            "Task {} has no branch_name — cannot integrate",
            task.id
        ));
    };

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
    };

    perform_git_integration(git, &params)
}

// -- Helpers --

/// Perform the git work for integration: rebase onto target branch, then merge.
fn perform_git_integration(
    git: &dyn GitService,
    params: &IntegrationParams,
) -> IntegrationGitResult {
    // Rebase onto target branch
    if let Some(worktree_path) = &params.worktree_path {
        let worktree = Path::new(worktree_path);
        if worktree.exists() {
            match git.rebase_on_branch(worktree, &params.target_branch) {
                Ok(()) => {
                    orkestra_debug!(
                        "integration",
                        "rebased {}: branch {} onto {}",
                        params.task_id,
                        params.branch_name,
                        params.target_branch
                    );
                }
                Err(GitError::MergeConflict { conflict_files, .. }) => {
                    orkestra_debug!(
                        "integration",
                        "failed {}: rebase conflict, {} files",
                        params.task_id,
                        conflict_files.len()
                    );
                    return IntegrationGitResult::RebaseConflict { conflict_files };
                }
                Err(e) => {
                    orkestra_debug!(
                        "integration",
                        "failed {}: rebase error: {}",
                        params.task_id,
                        e
                    );
                    return IntegrationGitResult::RebaseError(format!(
                        "Failed to rebase branch on {}: {e}",
                        params.target_branch
                    ));
                }
            }
        } else {
            orkestra_debug!(
                "integration",
                "worktree missing for {}, skipping rebase",
                params.task_id
            );
        }
    }

    // Fast-forward merge to target branch
    match git.merge_to_branch(&params.branch_name, &params.target_branch) {
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
