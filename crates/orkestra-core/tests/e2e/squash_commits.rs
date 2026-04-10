//! E2E tests for the squash commit workflow.
//!
//! Tests verify:
//! 1. Per-stage commits use LLM-generated format (task title as subject, Orkestra footer)
//! 2. Non-subtask integration squashes all commits into one
//! 3. Subtask integration squashes commits before merging to parent branch
//! 4. After conflict recovery, re-integration squashes all commits (including recovery)
//! 5. User-triggered `merge_task()` also squashes commits (same as auto-merge)

use std::path::Path;
use std::process::Command;

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::execution::SubtaskOutput;
use orkestra_core::workflow::merge_task_sync;
use orkestra_core::workflow::runtime::TaskState;

use super::helpers::{disable_auto_merge, enable_auto_merge, workflows, MockAgentOutput, TestEnv};

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

/// Get first-parent commit count on main branch since test start.
///
/// Uses `--first-parent` to count only the direct commits on main, not commits
/// reachable through merge commit parents. This correctly reports "1 new merge
/// commit" for a squash+no-ff merge workflow (where the squash commit lives
/// inside the merge commit as a non-first parent).
fn count_commits_on_main(repo_path: &Path, initial_main_commit: &str) -> usize {
    let output = Command::new("git")
        .args([
            "rev-list",
            "--first-parent",
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
// Test 1: Per-Stage Commits Use LLM-Generated Format
// =============================================================================

/// Per-stage commits should use LLM-generated messages (task title as subject, Orkestra footer).
#[test]
fn test_per_stage_commits_use_llm_format() {
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
            resources: vec![],
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan

    // Approve to trigger commit pipeline
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    // Verify the commit message uses LLM-generated format (task title as subject)
    // The commit happens during the Finishing -> Committing -> Finished pipeline
    let commit_message = get_head_commit_message(worktree_path);
    assert!(
        commit_message.contains("Test task"),
        "Commit subject should contain task title 'Test task', got: {commit_message}"
    );

    // Check the commit body contains the Orkestra footer (LLM format marker)
    let commit_body = get_head_commit_body(worktree_path);
    assert!(commit_body.is_some(), "Commit should have a body");
    let body = commit_body.unwrap();
    assert!(
        body.contains("Powered by Orkestra"),
        "Body should contain Orkestra footer, got: {body}"
    );

    // =========================================================================
    // Breakdown stage: verify LLM format also applies
    // =========================================================================

    // Create file change for breakdown stage
    create_file_in_worktree(
        worktree_path,
        "breakdown.md",
        "# Breakdown\n\nTask decomposition here.",
    );

    ctx.set_output_with_activity(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Task breakdown".to_string(),
            activity_log: Some("- Decomposed into subtasks\n- Defined dependencies".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process breakdown

    // Approve to trigger commit
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to work

    // Verify breakdown commit also uses LLM-generated format
    let breakdown_commit = get_head_commit_message(worktree_path);
    assert!(
        breakdown_commit.contains("Test task"),
        "Breakdown commit should contain task title 'Test task', got: {breakdown_commit}"
    );

    // Check breakdown commit body contains the Orkestra footer
    let breakdown_body = get_head_commit_body(worktree_path);
    assert!(
        breakdown_body.is_some(),
        "Breakdown commit should have a body"
    );
    let body = breakdown_body.unwrap();
    assert!(
        body.contains("Powered by Orkestra"),
        "Breakdown body should contain Orkestra footer, got: {body}"
    );
}

// =============================================================================
// Test 2: Integration Squashes Commits for Non-Subtask
// =============================================================================

/// Integration should squash all commits into one for non-subtask tasks.
#[test]
fn test_integration_squashes_commits_for_non_subtask() {
    let ctx = TestEnv::with_git(
        &enable_auto_merge(test_default_workflow()),
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
            resources: vec![],
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
            resources: vec![],
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
            resources: vec![],
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
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done -> integration (sync)

    // Task should be archived after integration
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after integration, got: {:?}",
        task.state
    );

    // Main should have exactly 1 new first-parent commit (the merge commit wrapping the squash)
    let commits_on_main = count_commits_on_main(ctx.repo_path(), &initial_main_commit);
    assert_eq!(
        commits_on_main, 1,
        "Main should have exactly 1 new first-parent commit, got: {commits_on_main}"
    );

    // The merge commit on main should have an LLM-generated message (from MockCommitMessageGenerator)
    // MockCommitMessageGenerator returns "{task_title}\n\nAutomated changes.\n..."
    let main_commit_sha = get_main_commit_sha(ctx.repo_path());
    let merge_commit_message = get_full_commit_message(ctx.repo_path(), &main_commit_sha);
    assert!(
        merge_commit_message.contains("Test squash task"),
        "Merge commit should contain task title, got: {merge_commit_message}"
    );
    assert!(
        merge_commit_message.contains("Automated changes"),
        "Merge commit should have LLM-generated body from mock, got: {merge_commit_message}"
    );
}

// =============================================================================
// Test 3: Subtask Integration Squashes Commits
// =============================================================================

/// Subtask integration should squash commits into one before merging to the parent branch.
#[test]
#[allow(clippy::too_many_lines)]
fn test_subtask_integration_squashes_commits() {
    let workflow = enable_auto_merge(workflows::with_subtasks());
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
            resources: vec![],
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan
    ctx.api().approve(&parent_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    // Breakdown stage: produce 2 subtasks - create file change
    create_file_in_worktree(
        parent_worktree,
        "breakdown.md",
        "# Breakdown\n\nSubtask design.",
    );
    ctx.set_output(
        &parent_id,
        MockAgentOutput::Subtasks {
            content: "Technical design".to_string(),
            subtasks: vec![
                SubtaskOutput {
                    title: "First subtask".to_string(),
                    description: "Implement the first part".to_string(),
                    detailed_instructions: "Implementation brief for first part".to_string(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Second subtask".to_string(),
                    description: "Implement the second part".to_string(),
                    detailed_instructions: "Implementation brief for second part".to_string(),
                    depends_on: vec![0],
                },
            ],
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process subtasks output
    ctx.api().approve(&parent_id).unwrap();
    ctx.advance(); // commit + advance (creates subtasks)

    // Parent should be waiting on children
    let parent = ctx.api().get_task(&parent_id).unwrap();
    assert!(
        parent.state.is_waiting_on_children(),
        "Parent should be WaitingOnChildren, got: {:?}",
        parent.state
    );

    // Get the first subtask (no deps, will run first)
    let subtasks = ctx.api().list_subtasks(&parent_id).unwrap();
    assert_eq!(subtasks.len(), 2, "Should have 2 subtasks");
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
            resources: vec![],
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
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done -> integration (sync)

    // Subtask should be archived
    let subtask = ctx.api().get_task(subtask_id).unwrap();
    assert!(
        subtask.is_archived(),
        "Subtask should be Archived after integration, got: {:?}",
        subtask.state
    );

    // Verify parent branch after subtask integration
    // Since subtask is archived, we need to check the parent's worktree
    let parent = ctx.api().get_task(&parent_id).unwrap();
    let parent_worktree = Path::new(parent.worktree_path.as_ref().unwrap());

    // Reset parent worktree HEAD to match the branch ref (which was updated by subtask merge)
    Command::new("git")
        .args(["reset", "--hard", &parent_branch])
        .current_dir(parent_worktree)
        .output()
        .expect("Failed to reset parent worktree");

    // Verify the merge commit (HEAD on parent branch) has an AI-generated message,
    // not git's default "Merge branch '...'" format.
    // MockCommitMessageGenerator::succeeding() produces: "{subtask_title}\n\n{body}\n\n⚡ Powered by Orkestra"
    let merge_commit_subject = get_head_commit_message(parent_worktree);
    assert!(
        merge_commit_subject.contains("First subtask"),
        "Merge commit subject should contain subtask title (AI-generated), got: {merge_commit_subject}"
    );

    let merge_commit_body = get_head_commit_body(parent_worktree);
    assert!(
        merge_commit_body
            .as_deref()
            .unwrap_or("")
            .contains("⚡ Powered by Orkestra"),
        "Merge commit body should have Orkestra footer, got: {merge_commit_body:?}"
    );

    // Verify it's an explicit merge commit (--no-ff produces 2 parents)
    let parents_output = Command::new("git")
        .args(["log", "-1", "--format=%P"])
        .current_dir(parent_worktree)
        .output()
        .expect("Failed to get parent SHAs");
    let parents = String::from_utf8_lossy(&parents_output.stdout)
        .trim()
        .to_string();
    let parent_count = parents.split_whitespace().count();
    assert_eq!(
        parent_count, 2,
        "HEAD on parent branch should be an explicit merge commit (2 parents), got: {parents}"
    );

    // Verify the squash commit (second parent of the merge commit) has the subtask title.
    // fallback_commit_message(title, id) returns just the title when title is non-empty.
    let squash_sha_output = Command::new("git")
        .args(["rev-parse", "HEAD^2"])
        .current_dir(parent_worktree)
        .output()
        .expect("Failed to get HEAD^2");
    assert!(
        squash_sha_output.status.success(),
        "HEAD^2 should exist (squash commit is second parent of merge commit)"
    );
    let squash_sha = String::from_utf8_lossy(&squash_sha_output.stdout)
        .trim()
        .to_string();
    let squash_subject_output = Command::new("git")
        .args(["log", "-1", "--format=%s", &squash_sha])
        .current_dir(parent_worktree)
        .output()
        .expect("Failed to get squash commit subject");
    let squash_subject = String::from_utf8_lossy(&squash_subject_output.stdout)
        .trim()
        .to_string();
    assert!(
        squash_subject.contains("First subtask"),
        "Squash commit should have subtask title as subject, got: {squash_subject}"
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
        &enable_auto_merge(test_default_workflow()),
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
            resources: vec![],
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
            resources: vec![],
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
            resources: vec![],
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
            route_to: None,
            activity_log: None,
            resources: vec![],
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
            resources: vec![],
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
        task.state
    );
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Work agent should have completed, got: {:?}",
        task.state
    );

    // Create file change for recovery commit
    create_file_in_worktree(worktree_path, "recovery.txt", "Recovery changes");

    // Approve the recovery work
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance to review

    // Verify task state at the recovery checkpoint
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("review"),
        "Task should be in review stage after recovery approval"
    );
    assert!(
        !task.is_archived(),
        "Task should not be archived during recovery"
    );

    // Verify we have commits on the branch after recovery
    // The squash happens during integration, so after conflict recovery but before re-integration,
    // we verify commits exist on the branch (the exact count varies based on timing).
    let commits_after_recovery = count_commits_since_merge_base(worktree_path, "main");
    assert!(
        commits_after_recovery >= 1,
        "Should have commits after recovery for subsequent squash, got: {commits_after_recovery}"
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
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done -> integration succeeds

    // Task should now be archived
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after successful integration, got: {:?}",
        task.state
    );

    // Main should have exactly 1 new first-parent commit (the merge commit wrapping the squash)
    let commits_on_main = count_commits_on_main(ctx.repo_path(), &initial_main_commit);
    assert_eq!(
        commits_on_main, 1,
        "Main should have exactly 1 new first-parent commit (squash + merge), got: {commits_on_main}"
    );
}

// =============================================================================
// Test 5: Integration with No Commits Succeeds
// =============================================================================

/// Integration should succeed gracefully when there are no commits to squash.
/// This exercises the `squash_commits` returning `Ok(false)` path.
#[test]
fn test_integration_with_no_commits_succeeds() {
    let ctx = TestEnv::with_git(
        &enable_auto_merge(test_default_workflow()),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let initial_main_commit = get_main_commit_sha(ctx.repo_path());

    let task = ctx.create_task("No-change task", "Task with no file modifications", None);
    let task_id = task.id.clone();
    let worktree_path = Path::new(task.worktree_path.as_ref().unwrap());

    // Planning stage - NO file changes (just artifact output)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan that makes no file changes".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit (no-op) + advance to breakdown

    // Breakdown stage - NO file changes
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Breakdown with no file changes".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process breakdown
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit (no-op) + advance to work

    // Work stage - NO file changes
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete with no changes".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process summary
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit (no-op) + advance to review

    // Verify no commits on task branch
    let commits_before = count_commits_since_merge_base(worktree_path, "main");
    assert_eq!(
        commits_before, 0,
        "Should have 0 commits when no file changes were made, got: {commits_before}"
    );

    // Review stage - triggers integration
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done -> integration (should succeed despite no commits)

    // Task should be archived
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after integration (even with no commits), got: {:?}",
        task.state
    );

    // Main should have 0 new commits (no squash happened because there was nothing to squash)
    let commits_on_main = count_commits_on_main(ctx.repo_path(), &initial_main_commit);
    assert_eq!(
        commits_on_main, 0,
        "Main should have 0 new commits when task had no changes, got: {commits_on_main}"
    );
}

// =============================================================================
// Test 6: User-Triggered merge_task() Squashes Commits
// =============================================================================

/// User-triggered `merge_task()` should squash commits the same way auto-merge does.
#[test]
fn test_merge_task_squashes_commits() {
    let ctx = TestEnv::with_git(
        &disable_auto_merge(test_default_workflow()),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // Record initial main commit for comparison
    let initial_main_commit = get_main_commit_sha(ctx.repo_path());

    let task = ctx.create_task("User merge squash test", "Description", None);
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
            resources: vec![],
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
            resources: vec![],
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
            resources: vec![],
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

    // Review stage (automated) — moves to Done but does NOT auto-integrate
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done (no auto-merge)

    // Verify task is Done+Idle (not archived — auto_merge is off)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Task should be Done, got: {:?}", task.state);
    assert!(task.state.is_done(), "Task should be Done");

    // User triggers merge (sync=true runs inline for tests)
    merge_task_sync(ctx.api_arc(), &task_id).unwrap();

    // Task should be archived after user-triggered merge
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after merge_task(), got: {:?}",
        task.state
    );

    // Main should have exactly 1 new first-parent commit (the merge commit wrapping the squash)
    let commits_on_main = count_commits_on_main(ctx.repo_path(), &initial_main_commit);
    assert_eq!(
        commits_on_main, 1,
        "Main should have exactly 1 new first-parent commit, got: {commits_on_main}"
    );

    // The merge commit on main should have an LLM-generated message (from MockCommitMessageGenerator)
    let main_commit_sha = get_main_commit_sha(ctx.repo_path());
    let merge_commit_message = get_full_commit_message(ctx.repo_path(), &main_commit_sha);
    assert!(
        merge_commit_message.contains("User merge squash test"),
        "Merge commit should contain task title, got: {merge_commit_message}"
    );
    assert!(
        merge_commit_message.contains("Automated changes"),
        "Merge commit should have LLM-generated body from mock, got: {merge_commit_message}"
    );
}
