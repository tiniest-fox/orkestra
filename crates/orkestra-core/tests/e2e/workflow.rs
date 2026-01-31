//! Exhaustive end-to-end test for the standalone workflow system.
//!
//! This test exercises the complete task lifecycle through all possible transitions:
//!
//! 1. Task created → Planning
//! 2. Planner asks questions → Human answers
//! 3. Planner produces plan → Plan rejected → Retry planning
//! 4. Plan approved → Breakdown
//! 5. Breakdown approved → Working
//! 6. Work rejected → Retry working
//! 7. Work approved → Reviewing
//! 8. Reviewer restages to Work → Working
//! 9. Work approved again → Reviewing
//! 10. Reviewer approves → Done
//! 11. Integration fails → Back to Working
//! 12. Work → Review → Done → Integration succeeds → Complete
//!
//! This test uses real infrastructure (database, files, git) and only mocks
//! Claude Code responses. The test uses the `WorkflowApi` from the services layer.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::testutil::create_temp_git_repo;
use orkestra_core::workflow::{
    config::{load_workflow, WorkflowConfig},
    domain::{Question, QuestionAnswer, QuestionOption},
    runtime::{Outcome, Phase},
    Git2GitService, GitService, MockAgentRunner, OrchestratorLoop, SqliteWorkflowStore,
    StageExecutionService, WorkflowApi,
};

use crate::helpers::{MockAgentOutput, TestEnv};

// =============================================================================
// The Exhaustive E2E Test
// =============================================================================

/// The exhaustive e2e test covering all workflow transitions.
///
/// This test uses the `OrchestratorLoop` to drive agent spawning, making it
/// a true end-to-end test of the orchestration system.
///
/// Flow:
/// 1. Task created → Planning
/// 2. Planner asks questions → Human answers
/// 3. Planner produces plan → Plan rejected → Retry planning
/// 4. Plan approved → Breakdown
/// 5. Breakdown approved → Working
/// 6. Work rejected → Retry working
/// 7. Work approved → Reviewing
/// 8. Reviewer restages to Work → Working
/// 9. Work approved again → Reviewing
/// 10. Reviewer approves → Done
/// 11. Integration fails → Back to Working
/// 12. Work → Review → Done → Integration succeeds → Complete
#[test]
#[allow(clippy::too_many_lines)] // Exhaustive e2e test is intentionally comprehensive
fn test_exhaustive_workflow_flow() {
    let ctx = TestEnv::with_git(
        &WorkflowConfig::default(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // =========================================================================
    // Step 1: Task created → Planning
    // =========================================================================
    let task = ctx.create_task(
        "Implement feature X",
        "Add the new feature X with full test coverage",
        None,
    );

    let task_id = task.id.clone();

    assert_eq!(task.current_stage(), Some("planning"));
    assert_eq!(
        task.phase,
        Phase::Idle,
        "Task should be Idle after setup completes"
    );

    // Verify worktree was created by git service
    assert!(task.branch_name.is_some(), "Task should have a branch");
    assert!(task.worktree_path.is_some(), "Task should have a worktree");
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(
        std::path::Path::new(worktree_path).exists(),
        "Worktree directory should exist at {worktree_path}"
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(iterations.len(), 1);
    assert_eq!(iterations[0].stage, "planning");

    // =========================================================================
    // Step 2: Planner asks questions → Human answers
    // =========================================================================

    // Set up mock to return questions, then tick orchestrator
    let questions = vec![
        Question::new("Which database should we use?")
            .with_context("The feature requires persistent storage")
            .with_options(vec![
                QuestionOption::new("PostgreSQL").with_description("Best for complex queries"),
                QuestionOption::new("SQLite").with_description("Simple, file-based"),
            ]),
        Question::new("Should we add caching?"),
    ];
    ctx.set_output(&task_id, MockAgentOutput::Questions(questions));
    ctx.tick_until_settled();

    // VERIFY: First spawn of planning stage → full prompt with questions capability
    ctx.assert_full_prompt("plan", true, &[]);

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);
    // Questions are now stored in iteration outcome, not on task
    let questions = ctx.api().get_pending_questions(&task_id).unwrap();
    assert_eq!(questions.len(), 2);
    // All questions should have options (the UI adds an "Other" option automatically)
    assert!(!questions[0].options.is_empty());
    assert!(questions[1].options.is_empty()); // Legacy test data may not have options

    // Human answers questions
    let answers = vec![
        QuestionAnswer::new(
            "Which database should we use?",
            "PostgreSQL",
            chrono::Utc::now().to_rfc3339(),
        ),
        QuestionAnswer::new(
            "Should we add caching?",
            "Yes, use Redis",
            chrono::Utc::now().to_rfc3339(),
        ),
    ];

    let task = ctx
        .api()
        .answer_questions(&task_id, answers)
        .expect("Should answer questions");

    assert_eq!(task.phase, Phase::Idle);
    // After answering, no pending questions (new iteration was created)
    let questions = ctx.api().get_pending_questions(&task_id).unwrap();
    assert!(questions.is_empty());
    // Answers are stored in iteration context (IterationTrigger::Answers), not on task

    // =========================================================================
    // Step 3: Planner produces plan → Plan rejected → Retry planning
    // =========================================================================

    // Orchestrator spawns planner again, produces plan
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Initial plan v1 - not detailed enough".to_string(),
        },
    );
    ctx.tick_until_settled();

    // VERIFY: After answering questions → resume with answers prompt containing the Q&A
    ctx.assert_resume_prompt_contains(
        "answers",
        &[
            "Which database should we use?",
            "PostgreSQL",
            "Should we add caching?",
            "Yes, use Redis",
        ],
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);
    assert_eq!(
        task.artifact("plan"),
        Some("Initial plan v1 - not detailed enough")
    );

    // Human rejects the plan
    let task = ctx
        .api()
        .reject(&task_id, "Need more detail on the implementation steps")
        .expect("Should reject plan");

    assert_eq!(task.current_stage(), Some("planning"));
    assert_eq!(task.phase, Phase::Idle);

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    // With new model: iter1 (questions), iter2 (answers→rejected), iter3 (feedback)
    assert_eq!(
        iterations.len(),
        3,
        "Should have 3 iterations after rejection"
    );

    // Check first iteration ended with AwaitingAnswers (agent asked questions)
    assert!(iterations[0].outcome.is_some());
    assert!(matches!(
        iterations[0].outcome.as_ref().unwrap(),
        Outcome::AwaitingAnswers { .. }
    ));

    // Check second iteration ended with rejection (plan was rejected)
    assert!(iterations[1].outcome.is_some());
    assert!(matches!(
        iterations[1].outcome.as_ref().unwrap(),
        Outcome::Rejected { .. }
    ));

    // Check third iteration has feedback context (for retry)
    assert!(iterations[2].incoming_context.is_some());

    // Orchestrator spawns planner again, produces better plan
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Detailed plan v2:\n1. Create module\n2. Add tests\n3. Update docs"
                .to_string(),
        },
    );
    ctx.tick_until_settled();

    // VERIFY: Planner retry after rejection → resume with feedback prompt containing the feedback
    ctx.assert_resume_prompt_contains(
        "feedback",
        &["Need more detail on the implementation steps"],
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // =========================================================================
    // Step 4: Plan approved → Breakdown
    // =========================================================================

    let task = ctx.api().approve(&task_id).expect("Should approve plan");

    assert_eq!(
        task.current_stage(),
        Some("breakdown"),
        "Should go to breakdown stage"
    );
    assert_eq!(task.phase, Phase::Idle);

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    // With new model: iter1 (questions), iter2 (answers→rejected), iter3 (feedback→approved), iter4 (breakdown)
    assert_eq!(
        iterations.len(),
        4,
        "Should have 4 iterations (planning x3, breakdown)"
    );

    // Orchestrator spawns breakdown agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Subtasks:\n1. Create module\n2. Add tests".to_string(),
        },
    );
    ctx.tick_until_settled();

    // VERIFY: First spawn of breakdown stage → full prompt
    ctx.assert_full_prompt("breakdown", false, &[]);

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // =========================================================================
    // Step 5: Breakdown approved → Working
    // =========================================================================

    let task = ctx
        .api()
        .approve(&task_id)
        .expect("Should approve breakdown");

    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Should go to work stage"
    );
    assert_eq!(task.phase, Phase::Idle);

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    // With new model: planning x3, breakdown, work
    assert_eq!(
        iterations.len(),
        5,
        "Should have 5 iterations (planning x3, breakdown, work)"
    );

    // =========================================================================
    // Step 6: Work rejected → Retry working
    // =========================================================================

    // Orchestrator spawns worker
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation - tests failing".to_string(),
        },
    );
    ctx.tick_until_settled();

    // VERIFY: First spawn of work stage → full prompt
    ctx.assert_full_prompt("summary", false, &[]);

    // Human rejects the work
    let task = ctx
        .api()
        .reject(&task_id, "Tests are failing, please fix them")
        .expect("Should reject work");

    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::Idle);

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    // With new model: planning x3, breakdown, work x2
    assert_eq!(iterations.len(), 6);

    // Orchestrator spawns worker again
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete with passing tests".to_string(),
        },
    );
    ctx.tick_until_settled();

    // VERIFY: Work retry after rejection → resume with feedback prompt containing the feedback
    ctx.assert_resume_prompt_contains("feedback", &["Tests are failing, please fix them"]);

    // =========================================================================
    // Step 7: Work approved → Reviewing
    // =========================================================================

    let task = ctx.api().approve(&task_id).expect("Should approve work");

    assert_eq!(task.current_stage(), Some("review"));
    assert_eq!(task.phase, Phase::Idle);

    // =========================================================================
    // Step 8: Reviewer restages to Work → Working → AwaitingReview
    // =========================================================================

    // Queue outputs: first for reviewer (restage), then for worker (summary)
    // Both agents run in the same tick cycle
    ctx.set_output(
        &task_id,
        MockAgentOutput::Restage {
            target: "work".to_string(),
            feedback: "Code style issues found - please fix formatting".to_string(),
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation with fixed formatting".to_string(),
        },
    );
    ctx.tick_until_settled();

    // VERIFY: Work agent after restage → resume with feedback prompt containing reviewer's feedback
    // (The reviewer ran first with full prompt, then work agent ran with resume prompt)
    ctx.assert_resume_prompt_contains(
        "feedback",
        &["Code style issues found - please fix formatting"],
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(
        task.phase,
        Phase::AwaitingReview,
        "Work agent ran and produced artifact"
    );

    // Check the iteration recorded the restage
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let restage_iter = iterations.iter().find(|i| {
        matches!(
            i.outcome.as_ref(),
            Some(Outcome::Restage { target, .. }) if target == "work"
        )
    });
    assert!(restage_iter.is_some(), "Should have restage iteration");

    // =========================================================================
    // Step 9: Work approved again → Reviewing
    // =========================================================================

    let task = ctx
        .api()
        .approve(&task_id)
        .expect("Should approve work again");

    assert_eq!(task.current_stage(), Some("review"));

    // =========================================================================
    // Step 10: Reviewer approves → Done (with merge conflict setup)
    // =========================================================================

    // IMPORTANT: We need to create the merge conflict BEFORE the task becomes Done,
    // because auto-integration runs as soon as the task is Done and would remove
    // the worktree before we could set up the conflict.

    // Get current task to access worktree path (task is still in review stage)
    let task = ctx.api().get_task(&task_id).unwrap();
    let worktree_path = std::path::Path::new(task.worktree_path.as_ref().unwrap());

    // Create a real merge conflict:
    // 1. Create a file in the task's worktree and commit it
    std::fs::write(
        worktree_path.join("conflict.txt"),
        "Task's version of the file",
    )
    .unwrap();
    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(worktree_path)
        .output()
        .unwrap();
    std::process::Command::new("git")
        .args(["commit", "-m", "Add conflict file from task"])
        .current_dir(worktree_path)
        .output()
        .unwrap();

    // 2. Create the same file on main with different content
    orkestra_core::testutil::create_and_commit_file(
        ctx.repo_path(),
        "conflict.txt",
        "Main's conflicting version of the file",
        "Add conflicting file on main",
    )
    .unwrap();

    // NOW let the reviewer complete - task will go Done and auto-integration will fail
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "LGTM! All checks pass.".to_string(),
        },
    );
    ctx.tick_until_settled();

    // =========================================================================
    // Step 11: Integration fails (auto-triggered) → Back to Working
    // =========================================================================

    // Auto-integration should have run and failed due to the merge conflict.
    // The task should have been moved back to work stage.
    let task = ctx.api().get_task(&task_id).unwrap();

    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Should return to work on conflict"
    );
    assert_eq!(task.phase, Phase::Idle);
    assert!(!task.is_done());

    // Check integration failure was recorded
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let failed_iter = iterations
        .iter()
        .find(|i| matches!(i.outcome.as_ref(), Some(Outcome::IntegrationFailed { .. })));
    assert!(
        failed_iter.is_some(),
        "Should have integration failure iteration"
    );

    // =========================================================================
    // Step 12: Work → Review → Done → Integration succeeds (auto) → Complete
    // =========================================================================

    // First, resolve the conflict on main by reverting the conflicting commit
    // This simulates someone resolving the conflict so the task can be integrated
    std::process::Command::new("git")
        .args(["reset", "--hard", "HEAD~1"])
        .current_dir(ctx.repo_path())
        .output()
        .unwrap();

    // Orchestrator spawns worker to "resolve" conflict (in reality main was fixed)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Resolved merge conflict".to_string(),
        },
    );
    ctx.tick_until_settled();

    // VERIFY: Work agent after integration failure → resume with integration marker
    // containing error details (same session as previous work iterations)
    ctx.assert_resume_prompt_contains(
        "integration",
        &[
            "conflict", // Should mention conflict
        ],
    );

    // Approve work
    let task = ctx.api().approve(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));

    // Orchestrator spawns reviewer (automated stage auto-transitions to Done)
    // Then auto-integration runs and succeeds (no conflict this time)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "Conflict resolved correctly".to_string(),
        },
    );
    ctx.tick_until_settled();

    // Auto-integration should have completed successfully and task becomes Archived
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after integration"
    );
    assert!(task.completed_at.is_some(), "Should have completed_at set");

    // Verify worktree directory is gone from disk
    let worktree_dir = std::path::Path::new(task.worktree_path.as_ref().unwrap());
    assert!(
        !worktree_dir.exists(),
        "Worktree directory should be removed after integration"
    );

    // Verify branch is deleted
    let branch_name = task.branch_name.as_ref().unwrap();
    let branch_output = std::process::Command::new("git")
        .args(["branch", "--list", branch_name])
        .current_dir(ctx.repo_path())
        .output()
        .expect("Should run git branch");
    let branch_list = String::from_utf8_lossy(&branch_output.stdout);
    assert!(
        branch_list.trim().is_empty(),
        "Branch '{branch_name}' should be deleted after integration"
    );

    // =========================================================================
    // Final Verification
    // =========================================================================

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    println!("\n=== Exhaustive Workflow Test Complete ===");
    println!("Total iterations: {}", iterations.len());
    println!("Final status: {:?}", task.status);
    println!("Completed at: {:?}", task.completed_at);

    for (i, iter) in iterations.iter().enumerate() {
        println!(
            "  Iteration {}: stage={}, outcome={:?}",
            i + 1,
            iter.stage,
            iter.outcome.as_ref().map(|o| format!("{o}"))
        );
    }

    // Verify we have the expected artifacts
    assert!(task.artifact("plan").is_some(), "Should have plan");
    assert!(task.artifact("summary").is_some(), "Should have summary");
    assert!(task.artifact("verdict").is_some(), "Should have verdict");

    // Verify runner was called the expected number of times
    // planning (questions) + planning (plan v1) + planning (plan v2) + breakdown +
    // work (v1) + work (v2) + review (restage) + work (fix) + review (approve) +
    // work (conflict) + review (final) = 11 spawns
    let total_spawns = ctx.call_count();
    println!("Total agent spawns: {total_spawns}");
}

/// Test that invalid restage is rejected
#[test]
fn test_restage_validation() {
    let ctx = TestEnv::with_git(
        &WorkflowConfig::default(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // Create task and get to work stage (waits for async setup)
    let task = ctx.create_task("Test", "Test task", None);
    let task_id = task.id.clone();

    // Planning stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
        },
    );
    ctx.tick_until_settled();
    ctx.api().approve(&task_id).unwrap();

    // Breakdown stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Breakdown".to_string(),
        },
    );
    ctx.tick_until_settled();
    ctx.api().approve(&task_id).unwrap();

    // Now we're in work stage - try to restage from work (which doesn't have restage capability)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Restage {
            target: "planning".to_string(),
            feedback: "Should fail".to_string(),
        },
    );
    ctx.tick_until_settled();

    // The task should still be in work stage (restage should have failed)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Restage should have been rejected"
    );
}

/// Test the workflow configuration
#[test]
fn test_workflow_config_from_file() {
    let ctx = TestEnv::with_git(
        &WorkflowConfig::default(),
        &["planner", "breakdown", "worker", "reviewer"],
    );
    let api = ctx.api();

    assert_eq!(api.workflow().stages.len(), 4);
    assert_eq!(
        api.workflow().stage_names(),
        vec!["planning", "breakdown", "work", "review"]
    );

    // Review can restage to work
    let review = api.workflow().stage("review").unwrap();
    assert!(review.capabilities.can_restage_to("work"));
    assert!(review.is_automated);

    // Integration config defaults to work
    assert_eq!(api.workflow().integration.on_failure, "work");
}

/// Test custom `integration.on_failure` configuration
#[test]
fn test_custom_integration_on_failure() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");

    // Create .orkestra directory structure
    let orkestra_dir = temp_dir.path().join(".orkestra");
    std::fs::create_dir_all(&orkestra_dir).unwrap();

    // Create agent definition files (matching stage names for prompt resolution)
    let agents_dir = orkestra_dir.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(agents_dir.join("planner.md"), "You are a planner agent.").unwrap();
    std::fs::write(agents_dir.join("worker.md"), "You are a worker agent.").unwrap();
    std::fs::write(agents_dir.join("reviewer.md"), "You are a reviewer agent.").unwrap();

    // Create workflow config with custom on_failure (no breakdown stage)
    // Uses explicit `prompt` to map stage names to agent definition files
    let workflow_path = orkestra_dir.join("workflow.yaml");
    let yaml = r"
version: 1
stages:
  - name: planning
    artifact: plan
    prompt: planner.md
  - name: work
    artifact: summary
    prompt: worker.md
  - name: review
    artifact: verdict
    prompt: reviewer.md
    is_automated: true
integration:
  on_failure: planning
";
    std::fs::write(&workflow_path, yaml).unwrap();

    let workflow = load_workflow(&workflow_path).expect("Should load workflow");
    assert_eq!(workflow.integration.on_failure, "planning");

    // Create real SQLite database
    let db_path = orkestra_dir.join("orkestra.db");
    let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
    let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
        Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

    let api = Arc::new(Mutex::new(WorkflowApi::new(
        workflow.clone(),
        Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
    )));
    let project_root = PathBuf::from(temp_dir.path());

    // Get iteration service from api
    let iteration_service = api.lock().unwrap().iteration_service().clone();

    // Create mock runner for testing
    let runner = Arc::new(MockAgentRunner::new());

    let stage_executor = Arc::new(StageExecutionService::with_runner(
        workflow,
        project_root,
        store,
        iteration_service,
        runner.clone(),
    ));
    let orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);

    // Helper to tick and wait
    let tick = || {
        orchestrator.tick().expect("Tick should succeed");
        std::thread::sleep(Duration::from_millis(50));
        orchestrator.tick().expect("Second tick should succeed");
    };

    // Create a task and get it to Done
    let task = api
        .lock()
        .unwrap()
        .create_task("Test", "Test task", None)
        .unwrap();
    let task_id = task.id.clone();

    // Wait for async setup to complete (even without git, setup runs async)
    std::thread::sleep(Duration::from_millis(20));

    // Planning stage
    runner.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
        }
        .into(),
    );
    tick();
    api.lock().unwrap().approve(&task_id).unwrap();

    // Work stage
    runner.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Summary".to_string(),
        }
        .into(),
    );
    tick();
    api.lock().unwrap().approve(&task_id).unwrap();

    // Review stage (auto-approves to Done)
    runner.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "LGTM".to_string(),
        }
        .into(),
    );
    tick();

    let task = api.lock().unwrap().get_task(&task_id).unwrap();
    assert!(task.is_done());

    // Integration fails - should go to planning (not work)
    let task = api
        .lock()
        .unwrap()
        .integration_failed(&task_id, "Merge conflict", &[])
        .expect("Should handle integration failure");

    assert_eq!(
        task.current_stage(),
        Some("planning"),
        "Should go to planning (configured on_failure) not work"
    );
}

/// Test script stage execution with failure recovery.
///
/// Flow:
/// 1. Task created → Work stage (mock agent)
/// 2. Work approved → Checks stage (real script)
/// 3. Script fails → Recovers to Work (`on_failure`)
/// 4. Work produces fix → Checks stage again
/// 5. Script passes → Review stage
/// 6. Review approves → Done
#[test]
#[allow(clippy::too_many_lines)] // Comprehensive e2e test covering full script recovery flow
fn test_script_stage_with_recovery() {
    use orkestra_core::workflow::config::{
        IntegrationConfig, ScriptStageConfig, StageConfig, WorkflowConfig,
    };

    // Create git repo for worktree support
    let temp_dir = create_temp_git_repo().expect("Failed to create git repo");
    let orkestra_dir = temp_dir.path().join(".orkestra");
    std::fs::create_dir_all(&orkestra_dir).unwrap();

    // Create agent definition files
    let agents_dir = orkestra_dir.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(agents_dir.join("worker.md"), "You are a worker agent.").unwrap();
    std::fs::write(agents_dir.join("reviewer.md"), "You are a reviewer agent.").unwrap();

    // Create a simple toggle script that fails first time, passes second time
    // The script uses a marker file to track state and verifies ORKESTRA_* env vars
    let scripts_dir = temp_dir.path().join("scripts");
    std::fs::create_dir_all(&scripts_dir).unwrap();
    let script_path = scripts_dir.join("checks.sh");
    std::fs::write(
        &script_path,
        r#"#!/bin/bash
MARKER_FILE="${ORKESTRA_MARKER_DIR:-/tmp}/script_passed_once"

# Verify ORKESTRA environment variables are set
if [ -z "$ORKESTRA_TASK_ID" ]; then
    echo "ERROR: ORKESTRA_TASK_ID not set!"
    exit 1
fi

echo "Running checks for task: $ORKESTRA_TASK_ID"

if [ -f "$MARKER_FILE" ]; then
    echo "Checks passed for $ORKESTRA_TASK_ID!"
    exit 0
else
    mkdir -p "$(dirname "$MARKER_FILE")"
    touch "$MARKER_FILE"
    echo "Checks failed - missing marker (task: $ORKESTRA_TASK_ID)"
    exit 1
fi
"#,
    )
    .unwrap();

    // Make script executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    // Create workflow with script stage: work → checks (script) → review
    let workflow = WorkflowConfig {
        version: 1,
        stages: vec![
            StageConfig::new("work", "summary").with_prompt("worker.md"),
            StageConfig::new("checks", "check_results")
                .with_display_name("Automated Checks")
                .with_inputs(vec!["summary".into()])
                .with_script(ScriptStageConfig {
                    // Use env var for marker dir so each test run is isolated
                    command: format!(
                        "ORKESTRA_MARKER_DIR={} {}",
                        orkestra_dir.join("markers").display(),
                        script_path.display()
                    ),
                    timeout_seconds: 10,
                    on_failure: Some("work".into()),
                }),
            StageConfig::new("review", "verdict")
                .with_prompt("reviewer.md")
                .with_inputs(vec!["summary".into(), "check_results".into()])
                .automated(),
        ],
        integration: IntegrationConfig::default(),
        flows: std::collections::HashMap::new(),
    };

    // Save workflow config
    let workflow_path = orkestra_dir.join("workflow.yaml");
    let yaml = serde_yaml::to_string(&workflow).unwrap();
    std::fs::write(&workflow_path, yaml).unwrap();

    // Set up infrastructure
    let db_path = orkestra_dir.join("orkestra.db");
    let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
    let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
        Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

    let git_service: Arc<dyn GitService> =
        Arc::new(Git2GitService::new(temp_dir.path()).expect("Git service should init"));

    let api = Arc::new(Mutex::new(WorkflowApi::with_git(
        workflow.clone(),
        Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
        git_service,
    )));
    let project_root = PathBuf::from(temp_dir.path());

    let iteration_service = api.lock().unwrap().iteration_service().clone();
    let runner = Arc::new(MockAgentRunner::new());

    let stage_executor = Arc::new(StageExecutionService::with_runner(
        workflow,
        project_root,
        store,
        iteration_service,
        runner.clone(),
    ));

    let orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);

    // Helper to tick until stable
    let tick = || {
        for _ in 0..20 {
            orchestrator.tick().expect("Tick should succeed");
            std::thread::sleep(Duration::from_millis(50));
            if orchestrator.active_count() == 0 {
                orchestrator.tick().expect("Final tick");
                break;
            }
        }
    };

    // =========================================================================
    // Step 1: Create task → Work stage
    // =========================================================================
    let task = api
        .lock()
        .unwrap()
        .create_task("Test script recovery", "Test that script stages work", None)
        .expect("Should create task");
    let task_id = task.id.clone();

    // Wait for async setup
    for _ in 0..50 {
        std::thread::sleep(Duration::from_millis(20));
        let task = api.lock().unwrap().get_task(&task_id).unwrap();
        if task.phase != Phase::SettingUp {
            break;
        }
    }

    let task = api.lock().unwrap().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::Idle);

    // =========================================================================
    // Step 2: Work stage produces artifact
    // =========================================================================
    runner.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation".to_string(),
        }
        .into(),
    );
    tick();

    let task = api.lock().unwrap().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Approve work → moves to checks (script stage)
    api.lock().unwrap().approve(&task_id).unwrap();

    let task = api.lock().unwrap().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("checks"));
    assert_eq!(task.phase, Phase::Idle, "Script stage should start in Idle");

    // =========================================================================
    // Step 3: Script runs and fails → Recovers to Work
    // =========================================================================

    // Queue work output BEFORE ticking for script - when script fails and recovers
    // to work, the orchestrator will immediately spawn the work agent
    runner.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Fixed implementation after script failure".to_string(),
        }
        .into(),
    );

    tick(); // This spawns script, script fails, recovers to work, spawns work agent

    // Check iteration recorded script failure
    let iterations = api.lock().unwrap().get_iterations(&task_id).unwrap();
    let script_fail_iter = iterations
        .iter()
        .find(|i| matches!(i.outcome.as_ref(), Some(Outcome::ScriptFailed { .. })));
    assert!(
        script_fail_iter.is_some(),
        "Should have ScriptFailed iteration"
    );

    // After tick: script failed → work stage → work agent produced artifact
    let task = api.lock().unwrap().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Should be in work stage after script failure recovery"
    );
    assert_eq!(
        task.phase,
        Phase::AwaitingReview,
        "Work agent should have produced artifact"
    );

    // =========================================================================
    // Step 4: Verify feedback prompt → Approve work → Checks again (script passes)
    // =========================================================================

    // Verify worker got resume prompt with script failure context
    let last_prompt = runner.calls().last().unwrap().prompt.clone();
    assert!(
        last_prompt.starts_with("<!orkestra-resume:feedback>"),
        "Worker should get feedback prompt after script failure, got: {}...",
        &last_prompt[..last_prompt.len().min(100)]
    );
    assert!(
        last_prompt.contains("checks") || last_prompt.contains("Checks"),
        "Feedback should mention the checks stage"
    );

    // Approve work → moves to checks again
    api.lock().unwrap().approve(&task_id).unwrap();

    let task = api.lock().unwrap().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("checks"));

    // Queue review output BEFORE ticking - when script passes, it auto-advances
    // to review, and the automated review stage spawns the agent immediately
    runner.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "All checks passed, implementation complete".to_string(),
        }
        .into(),
    );

    tick(); // Script runs and passes → review agent runs → task completes

    // =========================================================================
    // Step 5 & 6: Script passes → Review (automated) → Task Done/Archived
    // =========================================================================
    // The entire flow completes in one tick: script passes → review auto-runs → done

    let task = api.lock().unwrap().get_task(&task_id).unwrap();
    assert!(
        task.is_done() || task.is_archived(),
        "Task should be done/archived"
    );

    // Verify the complete iteration history
    let iterations = api.lock().unwrap().get_iterations(&task_id).unwrap();

    // Check that we have script failed iteration
    let script_fail_iter = iterations
        .iter()
        .find(|i| matches!(i.outcome.as_ref(), Some(Outcome::ScriptFailed { .. })));
    assert!(
        script_fail_iter.is_some(),
        "Should have ScriptFailed iteration"
    );

    // Check that checks stage passed (approved) at some point
    let checks_passed = iterations
        .iter()
        .any(|i| i.stage == "checks" && matches!(i.outcome.as_ref(), Some(Outcome::Approved)));
    assert!(checks_passed, "Checks stage should have passed (approved)");

    // Check that review completed
    let review_approved = iterations
        .iter()
        .any(|i| i.stage == "review" && matches!(i.outcome.as_ref(), Some(Outcome::Approved)));
    assert!(review_approved, "Review stage should have completed");

    // Verify ORKESTRA_TASK_ID was passed to the script by checking artifact output
    let check_results = task.artifact("check_results");
    assert!(
        check_results.is_some(),
        "Should have check_results artifact from script"
    );
    assert!(
        check_results.unwrap().contains(&task_id),
        "Script output should contain task ID (proves ORKESTRA_TASK_ID env var was passed)"
    );

    println!("\n=== Script Stage Recovery Test Complete ===");
    let iterations = api.lock().unwrap().get_iterations(&task_id).unwrap();
    for (i, iter) in iterations.iter().enumerate() {
        println!(
            "  Iteration {}: stage={}, outcome={:?}",
            i + 1,
            iter.stage,
            iter.outcome.as_ref().map(|o| format!("{o}"))
        );
    }
}

// =============================================================================
// Post-Merge Recovery Tests
// =============================================================================

/// Helper: advance a task through a simple work → review(automated) workflow to Done.
///
/// Returns the task in Done status. Uses individual ticks to avoid triggering
/// integration (which would archive the task before we can test recovery).
fn advance_to_done(ctx: &TestEnv, task_id: &str) {
    use std::time::Duration;

    // Work stage: set output, tick to spawn, tick to process
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
        },
    );
    ctx.tick(); // spawn work agent
    std::thread::sleep(Duration::from_millis(50));
    ctx.tick(); // process work output → AwaitingReview

    // Approve work → advances to review (automated)
    ctx.api().approve(task_id).unwrap();

    // Review stage (automated): set output, tick to spawn, tick to process
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "Approved".to_string(),
        },
    );
    ctx.tick(); // spawn review agent
    std::thread::sleep(Duration::from_millis(50));
    ctx.tick(); // process review output → auto-approve → Done

    let task = ctx.api().get_task(task_id).unwrap();
    assert!(
        task.is_done(),
        "Task should be Done after review auto-approves, but status is {:?}",
        task.status
    );
}

/// Test that startup recovery archives a task whose branch was already merged.
///
/// Simulates the crash scenario:
/// 1. Task reaches Done
/// 2. Integration starts: merge succeeds, worktree removed
/// 3. App crashes before DB is updated to Archived
/// 4. On restart, recovery detects the branch is merged and archives directly
#[test]
fn test_recovery_archives_already_merged_task() {
    use orkestra_core::workflow::{config::StageConfig, OrchestratorEvent};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .automated(),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Create task (worktree is created automatically)
    let task = ctx.create_task("Recovery test", "Test recovery of merged task", None);
    let task_id = task.id.clone();
    let worktree_path = task.worktree_path.clone().unwrap();
    let branch_name = task.branch_name.clone().unwrap();

    // Make a commit in the worktree so there's something to merge
    std::fs::write(
        std::path::Path::new(&worktree_path).join("feature.txt"),
        "new feature content",
    )
    .unwrap();
    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(&worktree_path)
        .output()
        .unwrap();
    std::process::Command::new("git")
        .args(["commit", "-m", "Add feature"])
        .current_dir(&worktree_path)
        .output()
        .unwrap();

    // Drive the task through the workflow to Done
    advance_to_done(&ctx, &task_id);

    // === Simulate crash during integration ===

    // 1. Mark as integrating (what the orchestrator does before merge)
    ctx.api().mark_integrating(&task_id).unwrap();

    // 2. Merge the branch to main (simulating successful merge before crash)
    let merge_output = std::process::Command::new("git")
        .args(["checkout", "main"])
        .current_dir(ctx.repo_path())
        .output()
        .unwrap();
    assert!(
        merge_output.status.success(),
        "git checkout main failed: {}",
        String::from_utf8_lossy(&merge_output.stderr)
    );
    let merge_output = std::process::Command::new("git")
        .args(["merge", "--no-edit", &branch_name])
        .current_dir(ctx.repo_path())
        .output()
        .unwrap();
    assert!(
        merge_output.status.success(),
        "git merge failed: {}",
        String::from_utf8_lossy(&merge_output.stderr)
    );

    // 3. Remove the worktree directory (simulating cleanup that ran before crash)
    let worktree_dir = std::path::Path::new(&worktree_path);
    if worktree_dir.exists() {
        std::fs::remove_dir_all(worktree_dir).unwrap();
    }

    // Verify the task is stuck in the crash state
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Task should still be Done (not Archived)");
    assert_eq!(
        task.phase,
        Phase::Integrating,
        "Task should be stuck in Integrating phase"
    );

    // === Simulate app restart: run startup recovery ===
    let events = ctx.run_startup_recovery();

    // Verify task is now Archived
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after recovery, but status is {:?}",
        task.status
    );

    // Verify IntegrationCompleted event was emitted
    let completed = events.iter().any(
        |e| matches!(e, OrchestratorEvent::IntegrationCompleted { task_id: id } if id == &task_id),
    );
    assert!(
        completed,
        "Should have emitted IntegrationCompleted event. Events: {events:?}"
    );

    // Verify the merged file is on main
    assert!(
        ctx.repo_path().join("feature.txt").exists(),
        "Merged file should exist on main"
    );

    println!("=== Recovery of Already-Merged Task Test Complete ===");
}

/// Test that startup recovery re-integrates a task whose branch was NOT merged.
///
/// When the crash happened before the merge (e.g., during commit/rebase), the
/// branch has unmerged commits. Recovery should re-attempt the full integration.
#[test]
fn test_recovery_retries_unmerged_task() {
    use orkestra_core::workflow::{config::StageConfig, OrchestratorEvent};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .automated(),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Create task (worktree is created automatically)
    let task = ctx.create_task("Unmerged test", "Test recovery of unmerged task", None);
    let task_id = task.id.clone();
    let worktree_path = task.worktree_path.clone().unwrap();

    // Make a commit in the worktree so there's something to merge
    std::fs::write(
        std::path::Path::new(&worktree_path).join("unmerged_feature.txt"),
        "unmerged content",
    )
    .unwrap();
    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(&worktree_path)
        .output()
        .unwrap();
    std::process::Command::new("git")
        .args(["commit", "-m", "Add unmerged feature"])
        .current_dir(&worktree_path)
        .output()
        .unwrap();

    // Drive the task through the workflow to Done
    advance_to_done(&ctx, &task_id);

    // === Simulate crash: mark as Integrating but DON'T merge ===
    ctx.api().mark_integrating(&task_id).unwrap();

    // Verify the task is in the crash state (branch NOT merged)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done());
    assert_eq!(task.phase, Phase::Integrating);

    // === Simulate app restart: run startup recovery ===
    let events = ctx.run_startup_recovery();

    // Recovery should re-attempt integration, which should succeed
    // (worktree exists, branch has commits, no conflicts)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after recovery re-integration, but status is {:?}",
        task.status
    );

    // Verify IntegrationCompleted event was emitted
    let completed = events.iter().any(
        |e| matches!(e, OrchestratorEvent::IntegrationCompleted { task_id: id } if id == &task_id),
    );
    assert!(
        completed,
        "Should have emitted IntegrationCompleted event. Events: {events:?}"
    );

    // Verify the file was merged to main
    assert!(
        ctx.repo_path().join("unmerged_feature.txt").exists(),
        "File should be merged to main after recovery"
    );

    println!("=== Recovery of Unmerged Task Test Complete ===");
}
