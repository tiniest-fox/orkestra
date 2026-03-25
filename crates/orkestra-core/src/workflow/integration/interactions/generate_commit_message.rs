//! LLM-based commit message generation for integration squash commits.

use crate::commit_message::{collect_model_names, fallback_commit_message, CommitMessageGenerator};
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::GitService;

/// Generate a commit message for a task using AI with fallback to task title.
///
/// Uses uncommitted changes diff. For squash commits during integration,
/// use `execute_for_squash` instead which uses committed changes.
pub(crate) fn execute(
    git: &dyn GitService,
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
) -> String {
    let diff_summary = super::build_diff_summary::execute(git, task);
    let recent_commits = fetch_recent_commits(git, task);
    generate_with_fallback(task, workflow, commit_gen, &diff_summary, &recent_commits)
}

/// Generate a squash commit message for integration using all committed changes.
///
/// Used during integration to create a single squash commit with an AI-generated
/// summary of all changes on the branch. Unlike `execute`, this uses
/// `build_diff_summary::execute_for_committed` which shows all committed changes
/// between the branch and its merge-base, not just uncommitted changes.
pub(crate) fn execute_for_squash(
    git: &dyn GitService,
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
) -> String {
    let diff_summary = super::build_diff_summary::execute_for_committed(git, task);
    let recent_commits = fetch_recent_commits(git, task);
    generate_with_fallback(task, workflow, commit_gen, &diff_summary, &recent_commits)
}

/// Generate a commit message for a task without git diff information.
///
/// Used when no git service is available (e.g., tests, no-worktree scenarios).
/// Still uses the full commit message pipeline (model attribution, Orkestra branding)
/// but passes a placeholder instead of a real diff summary.
///
/// For integration squash — per-stage commits use `commit_worktree::execute`.
pub(crate) fn execute_without_diff(
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
) -> String {
    generate_with_fallback(task, workflow, commit_gen, "No git diff available", &[])
}

// -- Helpers --

/// Generate commit message via AI, falling back to task title on failure.
fn generate_with_fallback(
    task: &Task,
    workflow: &WorkflowConfig,
    commit_gen: &dyn CommitMessageGenerator,
    diff_summary: &str,
    recent_commits: &[String],
) -> String {
    let model_names = collect_model_names(workflow, task.flow.as_deref());

    match commit_gen.generate_commit_message(
        &task.title,
        &task.description,
        diff_summary,
        recent_commits,
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

/// Fetch recent commit messages from the task's worktree branch.
fn fetch_recent_commits(git: &dyn GitService, task: &Task) -> Vec<String> {
    let Some(worktree_path) = &task.worktree_path else {
        return vec![];
    };
    match git.commit_log_at(std::path::Path::new(worktree_path), 5) {
        Ok(commits) => commits.into_iter().map(|c| c.message).collect(),
        Err(e) => {
            crate::orkestra_debug!("commit", "Failed to fetch recent commits: {e}");
            vec![]
        }
    }
}
