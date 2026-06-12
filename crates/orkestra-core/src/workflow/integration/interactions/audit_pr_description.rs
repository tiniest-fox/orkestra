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
    let commits_summary = super::format_commit_summaries::execute(git, worktree_dir, 20);

    // 3. Generate incremental update
    let updated_body = pr_desc_gen.update_pr_description(
        &task.title,
        &current_body,
        &commits_summary,
        &diff_summary,
    )?;

    // 3b. Validate mermaid (1 retry max — audit is non-fatal, avoid timeout cliff)
    let updated_body =
        super::validate_and_fix_mermaid::execute(&updated_body, &task.title, pr_desc_gen, 1);

    // 4. Apply updated description
    pr_service
        .update_pull_request_body(worktree_dir, branch, &updated_body)
        .map_err(|e| format!("Failed to update PR body: {e}"))?;

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use crate::pr_description::mock::MockPrDescriptionGenerator;
    use crate::workflow::domain::Task;
    use crate::workflow::ports::{MockGitService, MockPrService};

    use super::*;

    /// `update_pr_description` returns broken mermaid; `fix_pr_description` returns valid body.
    /// The audit pipeline must apply the fix before calling `update_pull_request_body`.
    ///
    /// The default update mock appends "_Updated by mock_" to the current body — so if the
    /// current body already contains broken mermaid the updated body also contains it, which
    /// exercises the fix path.
    #[test]
    fn audit_pr_description_validates_mermaid() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree_path = tmp.path().to_str().unwrap();

        let git = MockGitService::new();
        let pr_service = MockPrService::new();

        // Current PR body already has broken mermaid — the update mock will
        // preserve it (appends suffix), so the updated body is also broken.
        let broken = "## Summary\n\n```mermaid\ngraph TD\n  A[broken (parens)] --> B\n```\n";
        let fixed = "## Summary\n\n```mermaid\ngraph TD\n  A[\"fixed\"] --> B\n```\n";
        pr_service.set_next_get_body_result(Ok(broken.to_string()));

        // Queue the fix response.
        let pr_desc_gen =
            MockPrDescriptionGenerator::succeeding().push_fix_response(Ok(fixed.to_string()));

        let task = Task::new("t1", "Add feature", "Desc", "work", "2025-01-01T00:00:00Z")
            .with_branch("task/t1")
            .with_worktree(worktree_path);

        execute(&git, &pr_service, &pr_desc_gen, &task).unwrap();

        let calls = pr_service.update_body_calls();
        assert_eq!(calls.len(), 1, "update should be called once");
        let (_branch, body) = &calls[0];
        assert!(
            body.contains("fixed"),
            "update_pull_request_body should receive the fixed body, got: {body}"
        );
        assert_eq!(pr_desc_gen.fix_call_count(), 1);
    }
}
