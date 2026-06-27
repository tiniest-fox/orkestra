//! E2E tests for mono-repo support.
//!
//! Validates the full mono-repo flow: task creation with `.orkestra/` in a subdirectory,
//! worktree creation, agent cwd with subpath, and project root resolution from worktrees.

use std::path::Path;

use orkestra_core::testutil::fixtures::test_default_workflow;

use crate::helpers::TestEnv;

// =============================================================================
// Worktree Creation in Mono-Repo
// =============================================================================

#[test]
fn test_task_creation_in_monorepo() {
    let ctx =
        TestEnv::with_git_monorepo(&test_default_workflow(), &["planner", "worker"], "frontend");

    let task = ctx.create_task("Monorepo task", "Task in mono-repo project", None);

    // Worktree path should be set and exist on disk
    let wt_path = task
        .worktree_path
        .as_ref()
        .expect("Task should have a worktree path");
    assert!(
        Path::new(wt_path).exists(),
        "Worktree directory should exist at {wt_path}"
    );

    // Worktree should be under .orkestra/.worktrees/
    assert!(
        wt_path.contains(".orkestra/.worktrees/"),
        "Worktree path should be under .orkestra/.worktrees/, got: {wt_path}"
    );

    // Worktree should mirror the full git tree — frontend/ subdirectory must exist
    let frontend_in_worktree = Path::new(wt_path).join("frontend");
    assert!(
        frontend_in_worktree.exists(),
        "Worktree should contain the frontend/ subdirectory at {}",
        frontend_in_worktree.display()
    );
}

// =============================================================================
// Agent Working Directory in Mono-Repo
// =============================================================================

#[test]
fn test_agent_cwd_includes_subpath() {
    let ctx =
        TestEnv::with_git_monorepo(&test_default_workflow(), &["planner", "worker"], "frontend");

    let task = ctx
        .api()
        .create_task("Agent cwd test", "Check agent working dir", None)
        .expect("Should create task");
    let task_id = task.id.clone();

    // Setup (worktree creation)
    ctx.advance();
    // Spawn agent
    ctx.advance();

    assert!(
        ctx.call_count() > 0,
        "Agent should have been spawned after setup + advance"
    );

    let config = ctx.last_run_config();
    let working_dir = config.working_dir.to_string_lossy();

    assert!(
        working_dir.ends_with("/frontend"),
        "Agent working directory should end with /frontend (the project subpath), got: {working_dir}"
    );

    // Verify the task was set up
    let task = ctx.api().get_task(&task_id).expect("Should get task");
    assert!(
        task.worktree_path.is_some(),
        "Task should have a worktree path after setup"
    );
}

// =============================================================================
// Project Root Resolution from Mono-Repo Worktree
// =============================================================================

#[test]
fn test_find_project_root_from_monorepo_worktree() {
    use orkestra_core::testutil::create_temp_monorepo;

    let (temp_dir, project_root) =
        create_temp_monorepo("frontend").expect("Should create monorepo");
    let git_root = temp_dir.path();

    // Create .orkestra/ in the project subdirectory
    std::fs::create_dir_all(project_root.join(".orkestra/.worktrees"))
        .expect("Should create orkestra dirs");

    // Create a worktree manually under the project's .orkestra/.worktrees/
    let worktree_path = project_root.join(".orkestra/.worktrees/test-task");
    let output = std::process::Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            "task/test",
            worktree_path.to_str().unwrap(),
        ])
        .current_dir(git_root)
        .output()
        .expect("Should run git worktree add");
    assert!(
        output.status.success(),
        "git worktree add should succeed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(
        worktree_path.join(".git").is_file(),
        "Worktree should have .git file"
    );

    // find_main_repo_if_worktree should return the project root (with .orkestra/),
    // NOT the git root
    let found = orkestra_core::find_main_repo_if_worktree(&worktree_path);
    assert!(
        found.is_some(),
        "Should detect the project root from within the mono-repo worktree"
    );

    let found_canonical = found.unwrap().canonicalize().unwrap();
    let expected_canonical = project_root.canonicalize().unwrap();
    assert_eq!(
        found_canonical, expected_canonical,
        "Should return project root (with .orkestra/), not git root"
    );

    // Verify it did NOT return the git root
    let git_root_canonical = git_root.canonicalize().unwrap();
    assert_ne!(
        found_canonical, git_root_canonical,
        "Should NOT return git root — must return the subdirectory with .orkestra/"
    );
}
