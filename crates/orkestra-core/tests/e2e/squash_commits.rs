//! E2E tests for the squash commit workflow.
//!
//! Tests verify:
//! 1. Per-stage commits have the simple format (`{stage}: {task_id}`)
//! 2. Non-subtask integration squashes all commits into one
//! 3. Subtask integration does NOT squash (individual commits preserved)
//! 4. After conflict recovery, re-integration squashes all commits (including recovery)

use std::path::Path;
use std::process::Command;

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::execution::SubtaskOutput;
use orkestra_core::workflow::runtime::Phase;

use super::helpers::{workflows, MockAgentOutput, TestEnv};

// =============================================================================
// Helper: Git Commit Inspection
// =============================================================================

/// Get the most recent commit message on a branch in a worktree.
fn get_head_commit_message(worktree_path: &Path) -> String {
    let output = Command::new("git")
        .args(["log", "-1", "--format=%s"])
        .current_dir(worktree_path)
        .output()
        .expect("Failed to run git log");

    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Get the commit body (everything after the subject line) for the most recent commit.
fn get_head_commit_body(worktree_path: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["log", "-1", "--format=%b"])
        .current_dir(worktree_path)
        .output()
        .expect("Failed to run git log");

    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if body.is_empty() {
        None
    } else {
        Some(body)
    }
}

/// Count commits on the current branch since merge-base with another branch.
fn count_commits_since_merge_base(worktree_path: &Path, base_branch: &str) -> usize {
    let output = Command::new("git")
        .args(["rev-list", "--count", &format!("{base_branch}..HEAD")])
        .current_dir(worktree_path)
        .output()
        .expect("Failed to count commits");

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<usize>()
        .unwrap_or(0)
}

/// Get all commit messages on the current branch since merge-base with another branch.
fn get_commits_since_merge_base(worktree_path: &Path, base_branch: &str) -> Vec<String> {
    let output = Command::new("git")
        .args(["log", "--format=%s", &format!("{base_branch}..HEAD")])
        .current_dir(worktree_path)
        .output()
        .expect("Failed to get commits");

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

/// Get commit count on main branch since test start.
fn count_commits_on_main(repo_path: &Path, initial_main_commit: &str) -> usize {
    let output = Command::new("git")
        .args([
            "rev-list",
            "--count",
            &format!("{initial_main_commit}..main"),
        ])
        .current_dir(repo_path)
        .output()
        .expect("Failed to count commits on main");

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<usize>()
        .unwrap_or(0)
}

/// Get the current commit SHA of main branch.
fn get_main_commit_sha(repo_path: &Path) -> String {
    let output = Command::new("git")
        .args(["rev-parse", "main"])
        .current_dir(repo_path)
        .output()
        .expect("Failed to get main commit");

    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Get the full commit message (subject + body) of a specific commit.
fn get_full_commit_message(repo_path: &Path, commit_sha: &str) -> String {
    let output = Command::new("git")
        .args(["log", "-1", "--format=%B", commit_sha])
        .current_dir(repo_path)
        .output()
        .expect("Failed to get full commit message");

    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Create a file in a worktree to generate pending changes for commit.
fn create_file_in_worktree(worktree_path: &Path, filename: &str, content: &str) {
    std::fs::write(worktree_path.join(filename), content).expect("Failed to write file");
}

// =============================================================================
// Test 1: Per-Stage Commits Use Simple Format
// =============================================================================

/// Per-stage commits should have the format `{stage}: {task_id}` with activity log in body.
#[test]
fn test_per_stage_commits_use_simple_format() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test task", "Description for testing", None);
    let task_id = task.id.clone();
    let worktree_path = Path::new(task.worktree_path.as_ref().unwrap());

    // Planning stage: produce plan with activity log
    // Create a file change so commit_worktree_changes has something to commit
    create_file_in_worktree(
        worktree_path,
        "plan.md",
        "# Implementation Plan\n\nThis is the plan.",
    );

    ctx.set_output_with_activity(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Implementation plan".to_string(),
            activity_log: Some("- Analyzed requirements\n- Created plan".to_string()),
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan

    // Approve to trigger commit pipeline
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    // Verify the commit message format
    // The commit happens during the Finishing -> Committing -> Finished pipeline
    let commit_message = get_head_commit_message(worktree_path);
    assert!(
        commit_message.starts_with("planning: "),
        "Commit should start with 'planning: ', got: {commit_message}"
    );
    assert!(
        commit_message.contains(&task_id),
        "Commit should contain task ID '{task_id}', got: {commit_message}"
    );

    // Check the commit body contains the activity log
    let commit_body = get_head_commit_body(worktree_path);
    assert!(
        commit_body.is_some(),
        "Commit should have a body with activity log"
    );
    let body = commit_body.unwrap();
    assert!(
        body.contains("Analyzed requirements"),
        "Body should contain activity log, got: {body}"
    );
}

// =============================================================================
// Test 2: Integration Squashes Commits for Non-Subtask
// =============================================================================

/// Integration should squash all commits into one for non-subtask tasks.
#[test]
fn test_integration_squashes_commits_for_non_subtask() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // Record initial main commit for comparison
    let initial_main_commit = get_main_commit_sha(ctx.repo_path());

    let task = ctx.create_task("Test squash task", "Description", None);
    let task_id = task.id.clone();
    let worktree_path = Path::new(task.worktree_path.as_ref().unwrap());

    // Planning stage - create file change
    create_file_in_worktree(worktree_path, "plan.md", "# Plan\n\nImplementation plan.");
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Implementation plan".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    // Breakdown stage - create file change
    create_file_in_worktree(
        worktree_path,
        "breakdown.md",
        "# Breakdown\n\nTask breakdown.",
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Task breakdown".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process breakdown
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to work

    // Work stage - create file change
    create_file_in_worktree(
        worktree_path,
        "feature.txt",
        "Feature implementation complete.",
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process summary
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to review

    // Verify we have multiple commits on the task branch before integration
    let commits_before = count_commits_since_merge_base(worktree_path, "main");
    assert!(
        commits_before >= 3,
        "Should have at least 3 stage commits before integration, got: {commits_before}"
    );

    // Review stage (automated, auto-approves to Done, triggers integration)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done -> integration (sync)

    // Task should be archived after integration
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after integration, got: {:?}",
        task.status
    );

    // Main should have exactly 1 new commit (the squashed commit)
    let commits_on_main = count_commits_on_main(ctx.repo_path(), &initial_main_commit);
    assert_eq!(
        commits_on_main, 1,
        "Main should have exactly 1 squashed commit, got: {commits_on_main}"
    );

    // The squashed commit should have an LLM-generated message (from MockCommitMessageGenerator)
    // MockCommitMessageGenerator returns "{task_title}\n\nAutomated changes.\n..."
    let main_commit_sha = get_main_commit_sha(ctx.repo_path());
    let squashed_message = get_full_commit_message(ctx.repo_path(), &main_commit_sha);
    assert!(
        squashed_message.contains("Test squash task"),
        "Squashed commit should contain task title, got: {squashed_message}"
    );
    assert!(
        squashed_message.contains("Automated changes"),
        "Squashed commit should have LLM-generated body from mock, got: {squashed_message}"
    );
}

// =============================================================================
// Test 3: Subtask Integration Does NOT Squash
// =============================================================================

/// Subtask integration should preserve individual commits when merging to parent's branch.
#[test]
#[allow(clippy::too_many_lines)]
fn test_subtask_integration_preserves_commits() {
    let workflow = workflows::with_subtasks();
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create parent task
    let parent = ctx.create_task("Parent feature", "Build a feature with subtasks", None);
    let parent_id = parent.id.clone();
    let parent_worktree = Path::new(parent.worktree_path.as_ref().unwrap());

    // Planning stage for parent - create file change
    create_file_in_worktree(parent_worktree, "parent_plan.md", "# Parent Plan");
    ctx.set_output(
        &parent_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Parent implementation plan".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan
    ctx.api().approve(&parent_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    // Breakdown stage: produce a single subtask - create file change
    create_file_in_worktree(
        parent_worktree,
        "breakdown.md",
        "# Breakdown\n\nSubtask design.",
    );
    ctx.set_output(
        &parent_id,
        MockAgentOutput::Subtasks {
            content: "Technical design".to_string(),
            subtasks: vec![SubtaskOutput {
                title: "First subtask".to_string(),
                description: "Implement the first part".to_string(),
                detailed_instructions: "Implementation brief for first part".to_string(),
                depends_on: vec![],
            }],
            skip_reason: None,
            activity_log: None,
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process subtasks output
    ctx.api().approve(&parent_id).unwrap();
    ctx.advance(); // commit + advance (creates subtasks)

    // Parent should be waiting on children
    let parent = ctx.api().get_task(&parent_id).unwrap();
    assert!(
        parent.status.is_waiting_on_children(),
        "Parent should be WaitingOnChildren, got: {:?}",
        parent.status
    );

    // Get the subtask
    let subtasks = ctx.api().list_subtasks(&parent_id).unwrap();
    assert_eq!(subtasks.len(), 1, "Should have 1 subtask");
    let subtask_id = &subtasks[0].id;

    // Advance to set up subtask worktree
    ctx.advance();

    let subtask = ctx.api().get_task(subtask_id).unwrap();
    let subtask_worktree = Path::new(subtask.worktree_path.as_ref().unwrap());

    // Get parent's branch for counting commits
    let parent = ctx.api().get_task(&parent_id).unwrap();
    let parent_branch = parent.branch_name.clone().unwrap();

    // Work stage for subtask (subtask flow: work → review) - create file change
    create_file_in_worktree(
        subtask_worktree,
        "subtask_work.txt",
        "Subtask implementation.",
    );
    ctx.set_output(
        subtask_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Subtask work complete".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process summary

    // Approve work (advances to review)
    ctx.api().approve(subtask_id).unwrap();
    ctx.advance(); // commit + advance to review

    // Count commits on subtask branch before integration
    let commits_before = count_commits_since_merge_base(subtask_worktree, &parent_branch);
    assert!(
        commits_before >= 1,
        "Subtask should have at least 1 commit before integration, got: {commits_before}"
    );

    // Review stage (automated, auto-approves to Done, triggers integration)
    ctx.set_output(
        subtask_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Subtask looks good".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done -> integration (sync)

    // Subtask should be archived
    let subtask = ctx.api().get_task(subtask_id).unwrap();
    assert!(
        subtask.is_archived(),
        "Subtask should be Archived after integration, got: {:?}",
        subtask.status
    );

    // Verify parent branch has the subtask commits (not squashed)
    // Since subtask is archived, we need to check the parent's worktree
    let parent = ctx.api().get_task(&parent_id).unwrap();
    let parent_worktree = Path::new(parent.worktree_path.as_ref().unwrap());

    // Pull latest changes to parent worktree to see merged commits
    Command::new("git")
        .args(["reset", "--hard", &parent_branch])
        .current_dir(parent_worktree)
        .output()
        .expect("Failed to reset parent worktree");

    // Get commit messages on parent branch since main
    let parent_commits = get_commits_since_merge_base(parent_worktree, "main");

    // Subtask commits should be preserved (not squashed into one)
    // We expect individual stage commits like "work: subtask-id"
    let has_work_commit = parent_commits.iter().any(|c| c.starts_with("work:"));
    assert!(
        has_work_commit,
        "Parent branch should have individual subtask commits (not squashed). Commits: {parent_commits:?}"
    );
}

// =============================================================================
// Test 4: Conflict Recovery Squashes All Commits
// =============================================================================

/// After conflict recovery, re-integration should squash ALL commits including recovery ones.
#[test]
#[allow(clippy::too_many_lines)]
fn test_conflict_recovery_squashes_all_commits() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // Record initial main commit
    let initial_main_commit = get_main_commit_sha(ctx.repo_path());

    let task = ctx.create_task("Test conflict recovery", "Description", None);
    let task_id = task.id.clone();
    let worktree_path = Path::new(task.worktree_path.as_ref().unwrap());

    // Planning stage - create file change
    create_file_in_worktree(worktree_path, "plan.md", "# Plan");
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Implementation plan".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    // Breakdown stage - create file change
    create_file_in_worktree(worktree_path, "breakdown.md", "# Breakdown");
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Task breakdown".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process breakdown
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to work

    // Work stage: create a file that will conflict
    create_file_in_worktree(worktree_path, "conflict.txt", "Task's version");
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process summary
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to review

    // Verify we have multiple commits before integration attempt
    let commits_before_integration = count_commits_since_merge_base(worktree_path, "main");
    assert!(
        commits_before_integration >= 3,
        "Should have at least 3 commits before integration, got: {commits_before_integration}"
    );

    // Create conflict on main BEFORE review completes (so integration fails)
    orkestra_core::testutil::create_and_commit_file(
        ctx.repo_path(),
        "conflict.txt",
        "Main's conflicting version",
        "Add conflicting file on main",
    )
    .unwrap();

    // Review approves
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM".to_string(),
            activity_log: None,
        },
    );

    // Queue the recovery output before triggering integration
    // Recovery creates a new file to resolve conflict
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Resolved conflict".to_string(),
            activity_log: Some("- Fixed merge conflict in conflict.txt".to_string()),
        },
    );

    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done -> integration fails -> recovers to work -> spawns worker (completion ready)
    ctx.advance(); // processes work output

    // Task should be back in work stage (recovery)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Task should recover to work stage after conflict, got: {:?}",
        task.status
    );
    assert_eq!(
        task.phase,
        Phase::AwaitingReview,
        "Work agent should have completed"
    );

    // Create file change for recovery commit
    create_file_in_worktree(worktree_path, "recovery.txt", "Recovery changes");

    // Approve the recovery work
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to review

    // Verify we have commits on the branch after recovery
    // Note: The branch may have been rebased/squashed during the failed integration attempt,
    // so we just verify there are commits present (not comparing to pre-integration count)
    let commits_after_recovery = count_commits_since_merge_base(worktree_path, "main");
    assert!(
        commits_after_recovery >= 1,
        "Should have at least 1 commit after recovery, got: {commits_after_recovery}"
    );

    // Resolve conflict on main by reverting
    Command::new("git")
        .args(["checkout", "main"])
        .current_dir(ctx.repo_path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["reset", "--hard", "HEAD~1"])
        .current_dir(ctx.repo_path())
        .output()
        .unwrap();

    // Review stage again
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Conflict resolved".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done -> integration succeeds

    // Task should now be archived
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after successful integration, got: {:?}",
        task.status
    );

    // Main should have exactly 1 new commit (all commits squashed into one)
    let commits_on_main = count_commits_on_main(ctx.repo_path(), &initial_main_commit);
    assert_eq!(
        commits_on_main, 1,
        "Main should have exactly 1 squashed commit (including recovery commits), got: {commits_on_main}"
    );
}
