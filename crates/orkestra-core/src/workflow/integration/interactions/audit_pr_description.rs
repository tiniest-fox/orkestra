//! Audit and update a PR description to reflect the current branch state.

use std::path::Path;

use crate::pr_description::PrDescriptionGenerator;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, PrService};

/// Execute the PR description audit: fetch body -> gather branch state -> generate update -> apply.
///
/// Returns `Ok(())` on success or `Err(reason)` on any failure.
/// Callers treat all failures as non-fatal.
pub(crate) fn execute(
    git: &dyn GitService,
    pr_service: &dyn PrService,
    pr_desc_gen: &dyn PrDescriptionGenerator,
    task: &Task,
) -> Result<(), String> {
    let worktree_path = task.worktree_path.as_deref().ok_or("No worktree path")?;
    let branch = task.branch_name.as_deref().ok_or("No branch name")?;

    let worktree_dir = Path::new(worktree_path);

    // 1. Fetch current PR body from GitHub
    let current_body = pr_service
        .get_pull_request_body(worktree_dir, branch)
        .map_err(|e| format!("Failed to get PR body: {e}"))?;

    // 2. Gather current branch state using existing infrastructure
    let diff_summary = super::build_diff_summary::execute_for_committed(git, task);
    let commits_summary = format_commit_summaries(git, worktree_dir);

    // 3. Generate incremental update
    let updated_body = pr_desc_gen.update_pr_description(
        &task.title,
        &current_body,
        &commits_summary,
        &diff_summary,
    )?;

    // 4. Apply updated description
    pr_service
        .update_pull_request_body(worktree_dir, branch, &updated_body)
        .map_err(|e| format!("Failed to update PR body: {e}"))?;

    Ok(())
}

// -- Helpers --

/// Format recent commit messages for the AI prompt.
fn format_commit_summaries(git: &dyn GitService, worktree_path: &Path) -> String {
    use std::fmt::Write;
    match git.commit_log_at(worktree_path, 20) {
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
