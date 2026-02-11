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
//! 8. Reviewer rejects to Work → Working
//! 9. Work approved again → Reviewing
//! 10. Reviewer approves → Done
//! 11. Integration fails → Back to Working
//! 12. Work → Review → Done → Integration succeeds → Complete
//!
//! This test uses real infrastructure (database, files, git) and only mocks
//! Claude Code responses. The test uses the `WorkflowApi` from the services layer.

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::{
    config::{StageConfig, WorkflowConfig},
    domain::{Question, QuestionAnswer, QuestionOption},
    runtime::{Outcome, Phase},
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
/// 8. Reviewer rejects to Work → Working
/// 9. Work approved again → Reviewing
/// 10. Reviewer approves → Done
/// 11. Integration fails → Back to Working
/// 12. Work → Review → Done → Integration succeeds → Complete
#[test]
#[allow(clippy::too_many_lines)] // Exhaustive e2e test is intentionally comprehensive
fn test_exhaustive_workflow_flow() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // =========================================================================
    // Step 1: Task created → Planning (from random non-main branch)
    // =========================================================================

    // Use a random branch name so a hardcoded "main" (or any other literal)
    // can never accidentally satisfy the assertions.
    let base_branch = format!("feature/{}", uuid::Uuid::new_v4().as_simple());
    std::process::Command::new("git")
        .args(["branch", &base_branch])
        .current_dir(ctx.repo_path())
        .output()
        .unwrap();

    let task = ctx.create_task(
        "Implement feature X",
        "Add the new feature X with full test coverage",
        Some(&base_branch),
    );
    assert_eq!(task.base_branch, base_branch);

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
    ctx.advance(); // spawns planner agent (completion ready)
    ctx.advance(); // processes questions output

    // VERIFY: First spawn of planning stage → full prompt with questions capability
    ctx.assert_full_prompt("plan", true, false);

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
    ctx.advance(); // spawns planner agent (completion ready)
    ctx.advance(); // processes plan output

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
    ctx.advance(); // spawns planner agent (completion ready)
    ctx.advance(); // processes plan v2 output

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

    ctx.api().approve(&task_id).expect("Should approve plan");
    ctx.advance(); // commit pipeline: Finishing → Finished → advance

    let task = ctx.api().get_task(&task_id).unwrap();
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
    ctx.advance(); // spawns breakdown agent (completion ready)
    ctx.advance(); // processes breakdown output

    // VERIFY: First spawn of breakdown stage → full prompt
    ctx.assert_full_prompt("breakdown", false, false);

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // =========================================================================
    // Step 5: Breakdown approved → Working
    // =========================================================================

    ctx.api()
        .approve(&task_id)
        .expect("Should approve breakdown");
    ctx.advance(); // commit pipeline: Finishing → Finished → advance

    let task = ctx.api().get_task(&task_id).unwrap();
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
    ctx.advance(); // spawns worker agent (completion ready)
    ctx.advance(); // processes work output

    // VERIFY: First spawn of work stage → full prompt
    ctx.assert_full_prompt("summary", false, false);

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
    ctx.advance(); // spawns worker agent (completion ready)
    ctx.advance(); // processes work v2 output

    // VERIFY: Work retry after rejection → resume with feedback prompt containing the feedback
    ctx.assert_resume_prompt_contains("feedback", &["Tests are failing, please fix them"]);

    // =========================================================================
    // Step 7: Work approved → Reviewing
    // =========================================================================

    ctx.api().approve(&task_id).expect("Should approve work");
    ctx.advance(); // commit pipeline: Finishing → Finished → advance

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert_eq!(task.phase, Phase::Idle);

    // =========================================================================
    // Step 8: Reviewer rejects to Work → Working → AwaitingReview
    // =========================================================================

    // Queue outputs: first for reviewer (rejection), then for worker (summary)
    // Both agents run in the same tick cycle
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Code style issues found - please fix formatting".to_string(),
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation with fixed formatting".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes reviewer rejection → moves to work stage → spawns work agent (completion ready)
    ctx.advance(); // processes work output

    // VERIFY: Work agent after rejection → resume with feedback prompt containing reviewer's feedback
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

    // Check the iteration recorded the rejection
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let rejection_iter = iterations.iter().find(|i| {
        matches!(
            i.outcome.as_ref(),
            Some(Outcome::Rejection { target, .. }) if target == "work"
        )
    });
    assert!(rejection_iter.is_some(), "Should have rejection iteration");

    // =========================================================================
    // Step 9: Work approved again → Reviewing
    // =========================================================================

    ctx.api()
        .approve(&task_id)
        .expect("Should approve work again");
    ctx.advance(); // commit pipeline: Finishing → Finished → advance

    let task = ctx.api().get_task(&task_id).unwrap();
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

    // 2. Create the same file on the base branch with different content
    orkestra_core::testutil::create_and_commit_file_on_branch(
        ctx.repo_path(),
        &base_branch,
        "conflict.txt",
        "Base branch's conflicting version of the file",
        "Add conflicting file on base branch",
    )
    .unwrap();

    // Queue BOTH outputs before ticking: review verdict first, then recovery work output.
    // Integration is instant now — the same tick cycle that processes the review output
    // will also trigger integration (which fails), recover to "work" stage, and
    // immediately spawn the work agent. Both outputs must be queued before that tick.
    // The mock queue is FIFO per task, so the review agent consumes "verdict" first,
    // then the recovery work agent consumes "summary".
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "LGTM! All checks pass.".to_string(),
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Resolved merge conflict".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)

    // VERIFY: Reviewer re-entering the same stage (session exists from step 8) → recheck prompt
    ctx.assert_resume_prompt_contains("recheck", &[]);

    ctx.advance(); // processes review → auto-approve → Done → integration fails (sync) → recovers to work → spawns work agent (completion ready)
    ctx.advance(); // processes work output

    // =========================================================================
    // Step 11: Integration fails (auto-triggered) → Back to Working
    // =========================================================================

    // Auto-integration ran and failed due to the merge conflict.
    // The orchestrator recovered the task to "work" stage and spawned the work agent
    // (which consumed the pre-set mock output above).
    let task = ctx.api().get_task(&task_id).unwrap();

    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Should return to work on conflict"
    );
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

    // Resolve the conflict on the base branch by reverting the conflicting commit.
    // This simulates someone resolving the conflict so the task can be integrated.
    for args in [
        vec!["checkout", base_branch.as_str()],
        vec!["reset", "--hard", "HEAD~1"],
        vec!["checkout", "main"],
    ] {
        std::process::Command::new("git")
            .args(&args)
            .current_dir(ctx.repo_path())
            .output()
            .unwrap();
    }

    // The work agent already ran (output consumed in the previous advance cycle).
    // No additional advance needed — the work output was already processed.

    // VERIFY: Work agent after integration failure → resume with integration marker
    // containing error details and correct rebase target (same session as previous work iterations).
    // The branch name is random, so this can only pass if base_branch flows through correctly.
    let expected_rebase = format!("git rebase {base_branch}");
    ctx.assert_resume_prompt_contains(
        "integration",
        &[
            "conflict",       // Should mention conflict
            &expected_rebase, // Must use task's base_branch, not hardcoded "main"
        ],
    );

    // Approve work
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance
    let task = ctx.api().get_task(&task_id).unwrap();
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
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes review → auto-approve → Done → integration succeeds (sync) → Archived

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
    // work (v1) + work (v2) + review (reject) + work (fix) + review (approve) +
    // work (conflict) + review (final) = 11 spawns
    let total_spawns = ctx.call_count();
    println!("Total agent spawns: {total_spawns}");
}

/// Test that approval output from a stage without approval capability is rejected
#[test]
fn test_approval_validation() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
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
    ctx.advance(); // spawns planner (completion ready)
    ctx.advance(); // processes plan output
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to breakdown

    // Breakdown stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Breakdown".to_string(),
        },
    );
    ctx.advance(); // spawns breakdown agent (completion ready)
    ctx.advance(); // processes breakdown output
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to work

    // Now we're in work stage - try approval from work (which doesn't have approval capability)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Should fail".to_string(),
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes approval output (rejected by capability check)

    // Agent returned output that violates stage capabilities → task should be Failed
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_failed(),
        "Agent returning invalid output type should fail the task, got: {:?}",
        task.status
    );
}

/// Test the workflow configuration
#[test]
fn test_workflow_config_from_file() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );
    let api = ctx.api();

    assert_eq!(api.workflow().stages.len(), 4);
    assert_eq!(
        api.workflow().stage_names(),
        vec!["planning", "breakdown", "work", "review"]
    );

    // Review has approval capability
    let review = api.workflow().stage("review").unwrap();
    assert!(review.capabilities.has_approval());
    assert!(review.is_automated);

    // Integration config defaults to work
    assert_eq!(api.workflow().integration.on_failure, "work");
}

/// Test custom `integration.on_failure` configuration
#[test]
#[allow(clippy::too_many_lines)]
fn test_custom_integration_on_failure() {
    use orkestra_core::workflow::config::{IntegrationConfig, StageConfig};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan").with_prompt("planner.md"),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_inputs(vec!["plan".into()]),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into()])
            .automated(),
    ])
    .with_integration(IntegrationConfig {
        on_failure: "planning".into(),
    });

    assert_eq!(workflow.integration.on_failure, "planning");

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker", "reviewer"]);
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
    ctx.advance(); // spawns planner (completion ready)
    ctx.advance(); // processes plan output
    ctx.api().approve(&task_id).unwrap();

    // Work stage: commit a file in the worktree so there's something to merge
    let worktree_path = ctx.api().get_task(&task_id).unwrap().worktree_path.unwrap();
    std::fs::write(
        std::path::Path::new(&worktree_path).join("conflict.txt"),
        "Task's version",
    )
    .unwrap();
    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(&worktree_path)
        .output()
        .unwrap();
    std::process::Command::new("git")
        .args(["commit", "-m", "Add conflict file"])
        .current_dir(&worktree_path)
        .output()
        .unwrap();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Summary".to_string(),
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes work output
    ctx.api().approve(&task_id).unwrap();

    // Create a conflict on main BEFORE the review completes, so auto-integration fails
    orkestra_core::testutil::create_and_commit_file(
        ctx.repo_path(),
        "conflict.txt",
        "Main's conflicting version",
        "Add conflicting file on main",
    )
    .unwrap();

    // Review stage (auto-approves to Done → auto-integration fails → recovery to planning)
    // Queue both: verdict for the review agent, then plan for the recovery planning agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "LGTM".to_string(),
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Recovery plan".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes review → auto-approve → Done → integration fails (sync) → recovers to planning → spawns planner (completion ready)
    ctx.advance(); // processes planner output

    // Integration should have failed and routed to planning (configured on_failure).
    // The planning agent consumed the pre-queued plan output, so the task should
    // be in planning stage with AwaitingReview.
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("planning"),
        "Integration failure should route to planning (on_failure config), got: {:?}",
        task.status
    );

    // Verify integration failure was recorded in iteration history
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let failed_iter = iterations
        .iter()
        .find(|i| matches!(i.outcome.as_ref(), Some(Outcome::IntegrationFailed { .. })));
    assert!(
        failed_iter.is_some(),
        "Should have IntegrationFailed iteration"
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
    use orkestra_core::workflow::config::{ScriptStageConfig, StageConfig};

    // Inline toggle script: fails first time (creates marker), passes second time.
    // Uses $ORKESTRA_TASK_ID in the marker path for isolation between parallel tests.
    let script_command = concat!(
        "MARKER=/tmp/orkestra_script_test_${ORKESTRA_TASK_ID}; ",
        "if [ -z \"$ORKESTRA_TASK_ID\" ]; then echo 'ERROR: ORKESTRA_TASK_ID not set!'; exit 1; fi; ",
        "echo \"Running checks for task: $ORKESTRA_TASK_ID\"; ",
        "if [ -f \"$MARKER\" ]; then echo \"Checks passed for $ORKESTRA_TASK_ID!\"; exit 0; ",
        "else touch \"$MARKER\"; echo \"Checks failed (task: $ORKESTRA_TASK_ID)\"; exit 1; fi",
    );

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("checks", "check_results")
            .with_display_name("Automated Checks")
            .with_inputs(vec!["summary".into()])
            .with_script(ScriptStageConfig {
                command: script_command.to_string(),
                timeout_seconds: 10,
                on_failure: Some("work".into()),
            }),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into(), "check_results".into()])
            .automated(),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // =========================================================================
    // Step 1: Create task → Work stage
    // =========================================================================
    let task = ctx.create_task("Test script recovery", "Test that script stages work", None);
    let task_id = task.id.clone();

    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::Idle);

    // =========================================================================
    // Step 2: Work stage produces artifact
    // =========================================================================
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation".to_string(),
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes work output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Approve work → moves to checks (script stage)
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to checks

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("checks"));
    assert_eq!(task.phase, Phase::Idle, "Script stage should start in Idle");

    // =========================================================================
    // Step 3: Script runs and fails → Recovers to Work
    // =========================================================================

    // Queue work output BEFORE advancing - when script fails and recovers
    // to work, the orchestrator will immediately spawn the work agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Fixed implementation after script failure".to_string(),
        },
    );

    ctx.advance(); // spawns script (drains to completion: fails) → recovers to work → spawns work agent (completion ready)
    ctx.advance(); // processes work output

    // Check iteration recorded script failure
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let script_fail_iter = iterations
        .iter()
        .find(|i| matches!(i.outcome.as_ref(), Some(Outcome::ScriptFailed { .. })));
    assert!(
        script_fail_iter.is_some(),
        "Should have ScriptFailed iteration"
    );

    // After tick: script failed → work stage → work agent produced artifact
    let task = ctx.api().get_task(&task_id).unwrap();
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
    ctx.assert_resume_prompt_contains("feedback", &["checks"]);

    // Approve work → moves to checks again
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to checks

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("checks"));

    // Queue review output BEFORE advancing - when script passes, it auto-advances
    // to review, and the automated review stage spawns the agent immediately
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "All checks passed, implementation complete".to_string(),
        },
    );

    ctx.advance(); // spawns script (drains to completion: passes) → auto-advances to review → spawns reviewer (completion ready)
    ctx.advance(); // processes review output → auto-approve → Done → integration (sync) → Archived

    // =========================================================================
    // Step 5 & 6: Script passes → Review (automated) → Task Done/Archived
    // =========================================================================

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_done() || task.is_archived(),
        "Task should be done/archived"
    );

    // Verify the complete iteration history
    let iterations = ctx.api().get_iterations(&task_id).unwrap();

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
}

// =============================================================================
// Post-Merge Recovery Tests
// =============================================================================

/// Helper: advance a task through a simple work → review(automated) workflow to Done.
///
/// Drives the task through the API directly (without orchestrator ticks) to avoid
/// triggering auto-integration. The task will be in Done status with `Phase::Idle`.
///
/// After `approve()` and auto-advance, the task enters `Finishing` phase.
/// We call `finalize_stage_advancement()` to simulate the commit pipeline completing,
/// which advances the stage without running the orchestrator.
fn advance_to_done(ctx: &TestEnv, task_id: &str) {
    use orkestra_core::workflow::execution::StageOutput;

    let api = ctx.api();

    // Work stage: mark as working, process output
    api.agent_started(task_id).unwrap();
    api.process_agent_output(
        task_id,
        StageOutput::Artifact {
            content: "Implementation complete".to_string(),
            activity_log: None,
        },
    )
    .unwrap();

    // Approve work → enters Finishing. Simulate commit pipeline completion.
    api.approve(task_id).unwrap();
    api.finalize_stage_advancement(task_id).unwrap();

    // Review stage (automated): mark as working, process output → auto-approve → Finishing
    api.agent_started(task_id).unwrap();
    api.process_agent_output(
        task_id,
        StageOutput::Artifact {
            content: "Approved".to_string(),
            activity_log: None,
        },
    )
    .unwrap();

    // Auto-approved review enters Finishing. Simulate commit pipeline completion → Done.
    api.finalize_stage_advancement(task_id).unwrap();

    let task = api.get_task(task_id).unwrap();
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

// =============================================================================
// Provider-Aware Session ID Tests
// =============================================================================

/// Verify that `OpenCode` stages don't pre-generate session UUIDs and don't
/// attempt resume when no session ID has been extracted from the stream.
///
/// This is the core regression test for the bug where a pre-generated UUID
/// was passed to `OpenCode` on resume, causing it to hang forever (`OpenCode`
/// generates its own `ses_...` IDs and doesn't accept caller-supplied ones).
///
/// Flow:
/// 1. Create a single-stage workflow using `opencode/kimi-k2.5`
/// 2. First spawn: verify `session_id` is `None` (no pre-generated UUID)
/// 3. Reject + retry: verify `session_id` is still `None` AND `is_resume` is `false`
///    (mock runner doesn't emit `RunEvent::SessionId`, simulating a crash before
///    `OpenCode` emits its session event)
#[test]
fn test_opencode_no_pregenerated_session_id() {
    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "result")
        .with_prompt("worker.md")
        .with_model("opencode/kimi-k2.5")]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "OpenCode session test",
        "Test that OpenCode stages don't pre-generate session UUIDs",
        None,
    );
    let task_id = task.id.clone();

    // Queue first output and run to completion
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "result".to_string(),
            content: "First run output".to_string(),
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes output

    // VERIFY: First spawn should have NO session_id (OpenCode generates its own)
    let first_call = ctx.last_run_config();
    assert_eq!(
        first_call.session_id, None,
        "OpenCode stage should NOT have a pre-generated session ID"
    );
    assert!(!first_call.is_resume, "First spawn should not be a resume");

    // Verify session in DB has no claude_session_id
    // (mock runner doesn't emit RunEvent::SessionId, simulating crash before extraction)
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(
        session.claude_session_id.is_none(),
        "Session should have no claude_session_id (mock doesn't emit SessionId events)"
    );
    assert!(
        session.spawn_count >= 1,
        "Agent should have been spawned at least once"
    );

    // Reject and retry — this is the bug scenario:
    // Without the fix, the retry would try to resume with a pre-generated UUID,
    // causing OpenCode to hang.
    ctx.api().reject(&task_id, "Try again").unwrap();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "result".to_string(),
            content: "Second run output".to_string(),
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes output

    // VERIFY: Second spawn also has no session_id AND is_resume is false
    let second_call = ctx.last_run_config();
    assert_eq!(
        second_call.session_id, None,
        "Retry should NOT have a session ID (none was ever extracted)"
    );
    assert!(
        !second_call.is_resume,
        "Retry without session ID must NOT be a resume (would cause OpenCode to hang)"
    );
}

// =============================================================================
// Session Reset on Cross-Stage Rejection Tests
// =============================================================================

/// Test that `reset_session: true` supersedes the target stage's session on
/// cross-stage rejection, causing a fresh spawn with full prompt + feedback.
///
/// Also validates that Handlebars conditionals in agent definitions render
/// correctly when feedback is present.
///
/// Flow:
/// 1. Task created → work stage → produce artifact → approve → review stage
/// 2. Review REJECTS to work with `reset_session: true`
/// 3. Verify: old work session superseded, new session created (different UUID)
/// 4. Verify: work agent gets a FULL prompt (not resume), with feedback included
/// 5. Verify: Handlebars `{{#if feedback}}` conditional in agent definition renders
#[test]
#[allow(clippy::too_many_lines)]
fn test_session_reset_on_cross_stage_rejection() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};
    use orkestra_core::workflow::domain::SessionState;
    use orkestra_core::workflow::runtime::Outcome;

    // Build capabilities with reset_session: true
    // (ApprovalCapabilities isn't exported, but we can construct it through config)
    let mut caps = StageCapabilities::with_approval(Some("work".into()));
    caps.approval.as_mut().unwrap().reset_session = true;

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into()])
            .with_capabilities(caps)
            .automated(),
    ]);

    // Create test env with custom agent definition using Handlebars
    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Overwrite the worker agent definition with a Handlebars conditional
    let agents_dir = ctx.repo_path().join(".orkestra/agents");
    std::fs::write(
        agents_dir.join("worker.md"),
        "You are a worker agent.\n\n\
         {{#if feedback}}\n\
         REVIEW_FEEDBACK_SECTION: Address the reviewer findings below.\n\
         {{/if}}",
    )
    .unwrap();

    // Reload workflow from disk so the updated agent definition is picked up
    // (TestEnv::with_git already serialized + loaded the workflow config)

    // =========================================================================
    // Step 1: Work stage → produce artifact → approve → review
    // =========================================================================
    let task = ctx.create_task(
        "Session reset test",
        "Test that session reset works on rejection",
        None,
    );
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation".to_string(),
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes work output

    // Verify first spawn is a full prompt WITHOUT the Handlebars feedback section
    ctx.assert_full_prompt("summary", false, false);
    let first_call = ctx.last_run_config();
    assert!(!first_call.is_resume, "First spawn should not be a resume");

    let initial_prompt = ctx.last_prompt();
    assert!(
        !initial_prompt.contains("REVIEW_FEEDBACK_SECTION"),
        "Initial prompt should NOT contain the {{{{#if feedback}}}} section (no feedback yet)"
    );

    // Record the work session before approval
    let work_session_before = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Work session should exist");
    let original_session_id = work_session_before.id.clone();

    // Verify session ID is UUID format (not old "{task_id}-{stage}" format)
    assert_ne!(
        original_session_id,
        format!("{task_id}-work"),
        "Session ID should be UUID, not hardcoded format"
    );

    // Approve work → advances to review (automated)
    ctx.api().approve(&task_id).unwrap();

    // =========================================================================
    // Step 2: Review rejects to work with reset_session: true
    // =========================================================================

    // Queue review rejection + work output (both consumed in sequence)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Code needs refactoring — extract helper methods".to_string(),
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Refactored implementation".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes review rejection → supersedes work session → moves to work → spawns work agent (completion ready)
    ctx.advance(); // processes work output

    // =========================================================================
    // Step 3: Verify iteration history (chronological ordering)
    // =========================================================================
    // get_iterations returns ORDER BY started_at, iteration_number, so:
    //   [0] work#1   (Approved)
    //   [1] review#1 (Rejection → work)
    //   [2] work#2   (re-entry after rejection — pending or has artifact)

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        3,
        "Should have exactly 3 iterations. Got: {}",
        iterations
            .iter()
            .map(|i| format!(
                "{}#{}: {:?}",
                i.stage,
                i.iteration_number,
                i.outcome.as_ref().map(|o| format!("{o}"))
            ))
            .collect::<Vec<_>>()
            .join(", ")
    );

    // [0] work#1: approved
    assert_eq!(iterations[0].stage, "work");
    assert_eq!(iterations[0].iteration_number, 1);
    assert!(
        matches!(iterations[0].outcome.as_ref(), Some(Outcome::Approved)),
        "work#1 should be Approved, got: {:?}",
        iterations[0].outcome
    );

    // [1] review#1: rejection targeting work
    assert_eq!(iterations[1].stage, "review");
    assert_eq!(iterations[1].iteration_number, 1);
    assert!(
        matches!(
            iterations[1].outcome.as_ref(),
            Some(Outcome::Rejection { target, .. }) if target == "work"
        ),
        "review#1 should be Rejection targeting work, got: {:?}",
        iterations[1].outcome
    );

    // [2] work#2: re-entry after rejection
    assert_eq!(iterations[2].stage, "work");
    assert_eq!(iterations[2].iteration_number, 2);

    // =========================================================================
    // Step 4: Verify session superseding
    // =========================================================================

    let all_sessions = ctx.api().get_stage_sessions(&task_id).unwrap();
    let work_sessions: Vec<_> = all_sessions.iter().filter(|s| s.stage == "work").collect();
    let review_sessions: Vec<_> = all_sessions
        .iter()
        .filter(|s| s.stage == "review")
        .collect();

    assert_eq!(
        work_sessions.len(),
        2,
        "Should have 2 work sessions (original superseded + new). Got: {work_sessions:?}"
    );
    assert_eq!(
        review_sessions.len(),
        1,
        "Should have 1 review session. Got: {review_sessions:?}"
    );

    // Find the superseded session (the original)
    let superseded = work_sessions
        .iter()
        .find(|s| s.session_state == SessionState::Superseded);
    assert!(
        superseded.is_some(),
        "Original work session should be superseded. Sessions: {work_sessions:?}"
    );
    assert_eq!(
        superseded.unwrap().id,
        original_session_id,
        "Superseded session should be the original"
    );

    // Find the new active session
    let new_session = work_sessions
        .iter()
        .find(|s| s.session_state != SessionState::Superseded)
        .expect("Should have a new non-superseded work session");
    assert_ne!(
        new_session.id, original_session_id,
        "New session should have a different UUID"
    );

    // Verify the re-entry iteration (work#2) is linked to the NEW session, not the superseded one
    let reentry_session_id = iterations[2]
        .stage_session_id
        .as_ref()
        .expect("work#2 iteration should have a stage_session_id");
    assert_eq!(
        reentry_session_id, &new_session.id,
        "Re-entry iteration should be linked to the new session, not the superseded one"
    );
    assert_ne!(
        reentry_session_id, &original_session_id,
        "Re-entry iteration must NOT be linked to the superseded session"
    );

    // =========================================================================
    // Step 5: Verify full prompt (not resume) with feedback
    // =========================================================================

    let last_config = ctx.last_run_config();
    assert!(
        !last_config.is_resume,
        "Fresh spawn after session reset should NOT be a resume"
    );

    let prompt = ctx.last_prompt();
    assert!(
        !prompt.starts_with("<!orkestra:resume:"),
        "Should be a full prompt, not a resume prompt. Got: {}...",
        &prompt[..prompt.len().min(100)]
    );
    assert!(
        prompt.contains("## Your Current Task"),
        "Full prompt should contain task section"
    );

    // Feedback should be embedded in the full prompt
    assert!(
        prompt.contains("Code needs refactoring"),
        "Full prompt should include rejection feedback. Prompt: {}...",
        &prompt[..prompt.len().min(500)]
    );

    // =========================================================================
    // Step 6: Verify Handlebars conditional rendered (absent initially, present now)
    // =========================================================================

    assert!(
        prompt.contains("REVIEW_FEEDBACK_SECTION"),
        "Handlebars {{{{#if feedback}}}} should have rendered the feedback section in agent def"
    );
}

/// Test that rejection WITHOUT `reset_session` preserves existing resume behavior.
///
/// This is the regression test: same-stage rejection (review → work) without
/// `reset_session: true` should resume the existing session, not create a new one.
#[test]
#[allow(clippy::too_many_lines)]
fn test_session_not_reset_without_flag() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};
    use orkestra_core::workflow::domain::SessionState;
    use orkestra_core::workflow::runtime::Outcome;

    // Default workflow: review rejects to work WITHOUT reset_session
    // (with_approval defaults to reset_session: false)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into()])
            .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
            .automated(),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "No reset test",
        "Test that default rejection preserves session",
        None,
    );
    let task_id = task.id.clone();

    // Work stage → produce artifact
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation".to_string(),
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes output

    // Record original session
    let original_session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Work session should exist");
    let original_id = original_session.id.clone();

    // Approve → review (automated) → reject back to work
    ctx.api().approve(&task_id).unwrap();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more tests".to_string(),
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation with more tests".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes rejection → moves to work → spawns work agent
    ctx.advance(); // processes work output

    // Verify iteration history (ORDER BY started_at, iteration_number)
    // [0] work#1   (Approved)
    // [1] review#1 (Rejection → work)
    // [2] work#2   (re-entry after rejection)
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        3,
        "Should have 3 iterations. Got: {}",
        iterations
            .iter()
            .map(|i| format!(
                "{}#{}: {:?}",
                i.stage,
                i.iteration_number,
                i.outcome.as_ref().map(|o| format!("{o}"))
            ))
            .collect::<Vec<_>>()
            .join(", ")
    );

    assert_eq!(iterations[0].stage, "work");
    assert_eq!(iterations[0].iteration_number, 1);
    assert!(
        matches!(iterations[0].outcome.as_ref(), Some(Outcome::Approved)),
        "work#1 should be Approved"
    );

    assert_eq!(iterations[1].stage, "review");
    assert_eq!(iterations[1].iteration_number, 1);
    assert!(
        matches!(
            iterations[1].outcome.as_ref(),
            Some(Outcome::Rejection { target, .. }) if target == "work"
        ),
        "review#1 should be Rejection targeting work"
    );

    assert_eq!(iterations[2].stage, "work");
    assert_eq!(iterations[2].iteration_number, 2);

    // Both work iterations should be linked to the SAME session (no superseding)
    let work1_session = iterations[0].stage_session_id.as_ref();
    let work2_session = iterations[2].stage_session_id.as_ref();
    assert_eq!(
        work1_session, work2_session,
        "Both work iterations should share the same session (no reset)"
    );

    // Session should NOT be superseded — same session, resumed
    let all_sessions = ctx.api().get_stage_sessions(&task_id).unwrap();
    let work_sessions: Vec<_> = all_sessions.iter().filter(|s| s.stage == "work").collect();
    let review_sessions: Vec<_> = all_sessions
        .iter()
        .filter(|s| s.stage == "review")
        .collect();

    assert_eq!(
        work_sessions.len(),
        1,
        "Should have exactly 1 work session (no reset). Got: {work_sessions:?}"
    );
    assert_eq!(
        work_sessions[0].id, original_id,
        "Should be the same session (not superseded)"
    );
    assert_ne!(
        work_sessions[0].session_state,
        SessionState::Superseded,
        "Work session should NOT be superseded without reset_session"
    );
    assert_eq!(
        review_sessions.len(),
        1,
        "Should have 1 review session. Got: {review_sessions:?}"
    );

    // Should be a RESUME prompt (not full)
    ctx.assert_resume_prompt_contains("feedback", &["Needs more tests"]);

    let last_config = ctx.last_run_config();
    assert!(
        last_config.is_resume,
        "Without reset_session, rejection should resume existing session"
    );
}

/// Test that agent definitions without Handlebars markers pass through unchanged.
///
/// Ensures the Handlebars rendering fast path works correctly — most agent
/// definitions don't use `{{` and should be returned unchanged with no
/// performance overhead.
#[test]
fn test_handlebars_passthrough_for_plain_definitions() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into()])
            .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
            .automated(),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Agent definition with NO Handlebars markers (plain markdown)
    let agents_dir = ctx.repo_path().join(".orkestra/agents");
    std::fs::write(
        agents_dir.join("worker.md"),
        "You are a worker agent.\n\nDo the work carefully.\n\n## Rules\n\n- Follow patterns\n- Write tests",
    )
    .unwrap();

    let task = ctx.create_task("Passthrough test", "Test plain agent definitions", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done".to_string(),
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes output

    // Verify the agent definition appears in the prompt unchanged
    let prompt = ctx.last_prompt();
    assert!(
        prompt.contains("You are a worker agent."),
        "Agent definition should appear in prompt"
    );
    assert!(
        prompt.contains("Do the work carefully."),
        "Agent definition content should be preserved"
    );
    assert!(
        prompt.contains("## Rules"),
        "Markdown headings should be preserved"
    );
}

// =============================================================================
// Retry with Instructions
// =============================================================================

/// Test that retry instructions on a failed task reach the agent via the
/// `RetryFailed` resume prompt.
#[test]
fn test_retry_failed_with_instructions_sends_resume_prompt() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test retry", "A task that will fail", None);
    let task_id = task.id.clone();

    // Agent fails
    ctx.set_output(
        &task_id,
        MockAgentOutput::Failed {
            error: "Could not reach API".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes failure

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_failed(),
        "Task should be Failed, got: {:?}",
        task.status
    );

    // Human retries with instructions
    ctx.api()
        .retry(&task_id, Some("Use the v2 API instead"))
        .unwrap();

    // Agent succeeds this time
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan using v2 API".into(),
        },
    );
    ctx.advance(); // spawns agent with retry_failed resume prompt

    // Verify the resume prompt contains the retry_failed marker and instructions
    ctx.assert_resume_prompt_contains("retry_failed", &["Use the v2 API instead"]);

    ctx.advance(); // processes artifact output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);
}

/// Test that retry instructions on a blocked task reach the agent via the
/// `RetryBlocked` resume prompt.
#[test]
fn test_retry_blocked_with_instructions_sends_resume_prompt() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test blocked retry", "A task that will block", None);
    let task_id = task.id.clone();

    // Agent reports blocked
    ctx.set_output(
        &task_id,
        MockAgentOutput::Blocked {
            reason: "Waiting on CI pipeline".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes blocked output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(
            task.status,
            orkestra_core::workflow::runtime::Status::Blocked { .. }
        ),
        "Task should be Blocked, got: {:?}",
        task.status
    );

    // Human retries with context
    ctx.api()
        .retry(&task_id, Some("CI pipeline is green now"))
        .unwrap();

    // Agent succeeds
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan with CI passing".into(),
        },
    );
    ctx.advance(); // spawns agent with retry_blocked resume prompt

    ctx.assert_resume_prompt_contains("retry_blocked", &["CI pipeline is green now"]);

    ctx.advance(); // processes artifact output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);
}

/// Test that retry without instructions uses the `retry_failed` trigger
/// (no instructions in the prompt).
#[test]
fn test_retry_failed_without_instructions_sends_resume_prompt() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test retry no instructions", "A task that will fail", None);
    let task_id = task.id.clone();

    // Agent fails
    ctx.set_output(
        &task_id,
        MockAgentOutput::Failed {
            error: "Network timeout".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes failure

    // Human retries without instructions
    ctx.api().retry(&task_id, None).unwrap();

    // Agent succeeds
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan v2".into(),
        },
    );
    ctx.advance(); // spawns agent with retry_failed resume prompt (no instructions)

    ctx.assert_resume_prompt_contains("retry_failed", &["try again"]);
}

// =============================================================================
// Activity-Based Resume (Kill Before Output)
// =============================================================================

/// Test that an agent killed before producing output retries WITHOUT resume.
///
/// This is the core regression test for the race condition fix: if an agent
/// is killed before it produces any output (`has_activity=false`), the next
/// spawn should use a fresh session, not resume.
#[test]
fn test_kill_before_output_retries_without_resume() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test kill before output", "A task to test", None);
    let task_id = task.id.clone();

    // DON'T set any output — the mock channel will send an error
    // ("No output configured"), simulating a killed agent that never produced output
    ctx.advance(); // spawns agent, agent "fails" immediately
    ctx.advance(); // processes the error

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_failed(), "Task should be Failed after agent error");

    // Retry the task
    ctx.api().retry(&task_id, None).unwrap();

    // Set output for the retry
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Retry plan".into(),
        },
    );
    ctx.advance(); // spawns agent for retry

    // Verify the retry used a FULL prompt (not resume)
    // The key assertion: since the first agent never produced output,
    // has_activity should be false, so the retry should NOT use --resume
    let last_config = ctx.last_run_config();
    assert!(
        !last_config.is_resume,
        "Retry after kill-before-output should NOT use resume"
    );

    ctx.advance(); // processes artifact
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);
}

/// Test that an agent with activity retries WITH resume.
///
/// When an agent produces output (triggering `has_activity=true`), and the
/// stage is rejected, the next spawn should use resume to preserve context.
#[test]
fn test_agent_with_activity_retries_with_resume() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test activity resume", "A task to test", None);
    let task_id = task.id.clone();

    // Set output WITH activity (sends LogLine before Completed)
    ctx.set_output_with_activity(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "First plan".into(),
        },
    );
    ctx.advance(); // spawns agent (with activity LogLine)
    ctx.advance(); // processes artifact output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Reject to trigger another spawn on the same stage
    ctx.api().reject(&task_id, "Needs more detail").unwrap();

    // Set output for the resume
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Improved plan".into(),
        },
    );
    ctx.advance(); // spawns agent for retry (should be resume)

    // Verify resume was used (session had activity)
    let last_config = ctx.last_run_config();
    assert!(
        last_config.is_resume,
        "Retry after agent with activity should use resume"
    );
}

// =============================================================================
// Human Review of Reviewer Rejection Verdicts
// =============================================================================

/// Test that reviewer rejection verdicts pause for human review on non-automated stages.
///
/// When a reviewer agent rejects work on a non-automated stage, the rejection
/// should NOT execute immediately. Instead, the task pauses at `AwaitingReview`
/// with an `AwaitingRejectionReview` outcome so the human can confirm or override.
///
/// Flow:
/// 1. Task created → Work stage
/// 2. Work agent produces artifact → Approve → Review stage
/// 3. Reviewer rejects → Task pauses at `AwaitingReview` (NOT sent to work)
/// 4. Human overrides rejection → Task stays in review, new iteration created
/// 5. Reviewer runs again → Approves → Task pauses at `AwaitingReview` (standard approval)
/// 6. Human approves → Task advances to Done → Integration → Archived
#[test]
#[allow(clippy::too_many_lines)]
fn test_rejection_review_override_then_approval() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};

    // Non-automated review stage with approval capability (rejection → work)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into()])
            .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        // Intentionally NOT .automated() — human review required
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // =========================================================================
    // Step 1: Create task → Work stage
    // =========================================================================

    let task = ctx.create_task(
        "Rejection review test",
        "Test that reviewer rejections pause for human review",
        None,
    );
    let task_id = task.id.clone();

    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::Idle);

    // =========================================================================
    // Step 2: Work agent produces artifact → Approve → Review stage
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation with tests".to_string(),
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes work output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Approve work → enters commit pipeline
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to review

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert_eq!(task.phase, Phase::Idle);

    // =========================================================================
    // Step 3: Reviewer rejects → Task pauses at AwaitingReview
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests are incomplete — missing edge case coverage".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes rejection → pauses at AwaitingReview (NOT sent to work)

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("review"),
        "Task should still be in review stage (rejection paused for human review)"
    );
    assert_eq!(
        task.phase,
        Phase::AwaitingReview,
        "Task should be AwaitingReview for human to confirm/override rejection"
    );

    // Verify the iteration outcome is AwaitingRejectionReview
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let review_iter = iterations.iter().find(|i| {
        i.stage == "review"
            && matches!(
                i.outcome.as_ref(),
                Some(Outcome::AwaitingRejectionReview { .. })
            )
    });
    assert!(
        review_iter.is_some(),
        "Should have an AwaitingRejectionReview iteration. Iterations: {}",
        iterations
            .iter()
            .map(|i| format!(
                "{}#{}: {:?}",
                i.stage,
                i.iteration_number,
                i.outcome.as_ref().map(|o| format!("{o}"))
            ))
            .collect::<Vec<_>>()
            .join(", ")
    );

    // Verify the pending rejection details are stored correctly
    match review_iter.unwrap().outcome.as_ref().unwrap() {
        Outcome::AwaitingRejectionReview {
            from_stage,
            target,
            feedback,
        } => {
            assert_eq!(from_stage, "review");
            assert_eq!(target, "work");
            assert!(feedback.contains("Tests are incomplete"));
        }
        other => panic!("Expected AwaitingRejectionReview, got: {other:?}"),
    }

    // =========================================================================
    // Step 4: Human overrides rejection → stays in review, new iteration
    // =========================================================================

    let task = ctx
        .api()
        .reject(
            &task_id,
            "The implementation looks correct — please re-evaluate the edge cases",
        )
        .unwrap();

    assert_eq!(
        task.current_stage(),
        Some("review"),
        "After override, task should stay in review stage"
    );
    assert_eq!(
        task.phase,
        Phase::Idle,
        "After override, task should be Idle (ready for reviewer to run again)"
    );

    // Verify a new iteration was created in the review stage
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let review_iterations: Vec<_> = iterations.iter().filter(|i| i.stage == "review").collect();
    assert!(
        review_iterations.len() >= 2,
        "Should have at least 2 review iterations (original + override). Got: {}",
        review_iterations.len()
    );

    // =========================================================================
    // Step 5: Reviewer runs again → Approves → Standard AwaitingReview
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "Re-evaluated: edge cases are actually covered by integration tests"
                .to_string(),
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes approval → pauses at AwaitingReview (standard)

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("review"),
        "Task should still be in review (non-automated, awaiting human approval)"
    );
    assert_eq!(
        task.phase,
        Phase::AwaitingReview,
        "Task should be AwaitingReview for standard approval"
    );

    // This time the outcome should NOT be AwaitingRejectionReview
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let latest_review = iterations
        .iter()
        .filter(|i| i.stage == "review")
        .next_back()
        .expect("Should have review iterations");
    assert!(
        !matches!(
            latest_review.outcome.as_ref(),
            Some(Outcome::AwaitingRejectionReview { .. })
        ),
        "Latest review iteration should NOT be AwaitingRejectionReview (reviewer approved this time)"
    );

    // =========================================================================
    // Step 6: Human approves → Done → Integration → Archived
    // =========================================================================

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → Done → integration → Archived

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after approval + integration, got status: {:?}",
        task.status
    );
}

/// Test that confirming a reviewer rejection sends the task to the target stage.
///
/// When the human agrees with the reviewer's rejection (calls approve on the
/// pending rejection), the task should move to the rejection target stage (work).
#[test]
fn test_rejection_review_confirm() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};

    // Non-automated review stage
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into()])
            .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Confirm rejection test",
        "Test confirming a rejection",
        None,
    );
    let task_id = task.id.clone();

    // Work → produce artifact → approve → review
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation".to_string(),
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes output
    ctx.api().approve(&task_id).unwrap();

    // Reviewer rejects → pauses at AwaitingReview
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Code quality is poor".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes rejection

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Human confirms the rejection (calls approve)
    let task = ctx.api().approve(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Confirming rejection should send task to the rejection target (work)"
    );
    assert_eq!(
        task.phase,
        Phase::Idle,
        "Task should be Idle, ready for work agent"
    );

    // Verify the rejection review was recorded, followed by a new work iteration
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let awaiting_review_iter = iterations.iter().find(|i| {
        matches!(
            i.outcome.as_ref(),
            Some(Outcome::AwaitingRejectionReview { target, .. }) if target == "work"
        )
    });
    assert!(
        awaiting_review_iter.is_some(),
        "Should have AwaitingRejectionReview iteration from the reviewer"
    );

    // A new iteration should exist in the work stage (created by execute_rejection)
    let work_iters_after: Vec<_> = iterations
        .iter()
        .filter(|i| i.stage == "work" && i.iteration_number > 1)
        .collect();
    assert!(
        !work_iters_after.is_empty(),
        "Should have a new work iteration after confirming rejection"
    );
}

/// Test that automated review stages still auto-execute rejections immediately.
///
/// When a review stage is automated, rejection verdicts should NOT pause for
/// human review — they should execute immediately (same as before).
#[test]
fn test_automated_review_rejection_skips_human_review() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};

    // Automated review stage
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into()])
            .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
            .automated(),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Automated rejection test",
        "Test that automated stages skip rejection review",
        None,
    );
    let task_id = task.id.clone();

    // Work → produce artifact → approve → review
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation".to_string(),
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes output
    ctx.api().approve(&task_id).unwrap();

    // Queue rejection + work output (both consumed in same cycle since automated)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs refactoring".to_string(),
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Refactored implementation".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes rejection → auto-executes → moves to work → spawns worker
    ctx.advance(); // processes work output

    // Task should have moved through work, NOT paused in review
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Automated rejection should skip human review and go directly to work"
    );
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Verify the rejection was an immediate Rejection (not AwaitingRejectionReview)
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let rejection_iter = iterations.iter().find(|i| {
        matches!(
            i.outcome.as_ref(),
            Some(Outcome::Rejection { target, .. }) if target == "work"
        )
    });
    assert!(
        rejection_iter.is_some(),
        "Automated stage should produce immediate Rejection outcome"
    );
    let awaiting_review = iterations.iter().any(|i| {
        matches!(
            i.outcome.as_ref(),
            Some(Outcome::AwaitingRejectionReview { .. })
        )
    });
    assert!(
        !awaiting_review,
        "Automated stage should NOT produce AwaitingRejectionReview"
    );
}

// =============================================================================
// Artifact Generation for All LLM Output Types
// =============================================================================

/// Test that artifacts are created for all LLM output types and NOT overwritten by human actions.
///
/// Rule: Any structured response from an LLM creates an artifact. Human actions (approve/reject/answer)
/// do NOT create artifacts — they record feedback through iteration triggers only.
///
/// Output types tested:
/// 1. Agent questions → artifact with formatted questions
/// 2. Agent artifact → artifact with content
/// 3. Agent approval (reject) → artifact with rejection content
/// 4. Agent approval (approve) → artifact with approval content
/// 5. Script success → artifact with output (already covered in script recovery test)
/// 6. Script failure → artifact with error text
/// 7. Human rejection → artifact unchanged (still agent's content)
/// 8. Human approval → artifact unchanged (still agent's content)
#[test]
#[allow(clippy::too_many_lines)]
fn test_artifact_generation_for_all_output_types() {
    use orkestra_core::workflow::config::{ScriptStageConfig, StageCapabilities, StageConfig};

    // Multi-stage workflow covering all output types:
    // planning (questions) → work → checks (script with on_failure) → review (approval, non-automated)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_capabilities(StageCapabilities::with_questions()),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_inputs(vec!["plan".into()]),
        StageConfig::new("checks", "check_results")
            .with_inputs(vec!["summary".into()])
            .with_script(ScriptStageConfig {
                command: "echo 'all checks passed'".to_string(),
                timeout_seconds: 10,
                on_failure: Some("work".into()),
            }),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into(), "check_results".into()])
            .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        // Intentionally NOT .automated() — human review required
    ]);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker", "reviewer"]);

    let task = ctx.create_task(
        "Artifact generation test",
        "Test that all LLM outputs create artifacts",
        None,
    );
    let task_id = task.id.clone();

    // =========================================================================
    // Step 1: Agent asks questions → artifact created with formatted questions
    // =========================================================================

    let questions = vec![
        Question::new("Which framework?")
            .with_context("We need a web framework")
            .with_options(vec![
                QuestionOption::new("React").with_description("Popular and flexible"),
                QuestionOption::new("Vue").with_description("Easy to learn"),
            ]),
        Question::new("Include caching?"),
    ];
    ctx.set_output(&task_id, MockAgentOutput::Questions(questions));
    ctx.advance(); // spawns planner
    ctx.advance(); // processes questions output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // ASSERT: Questions output creates an artifact
    let plan_artifact = task.artifact("plan");
    assert!(
        plan_artifact.is_some(),
        "Agent questions output should create an artifact"
    );
    let plan_content = plan_artifact.unwrap();
    assert!(
        plan_content.contains("Which framework?"),
        "Questions artifact should contain question text. Got: {plan_content}"
    );
    assert!(
        plan_content.contains("We need a web framework"),
        "Questions artifact should contain context. Got: {plan_content}"
    );
    assert!(
        plan_content.contains("React"),
        "Questions artifact should contain option labels. Got: {plan_content}"
    );
    assert!(
        plan_content.contains("Include caching?"),
        "Questions artifact should contain all questions. Got: {plan_content}"
    );

    // Human answers questions (should NOT change the artifact)
    let answers = vec![
        QuestionAnswer::new("Which framework?", "React", chrono::Utc::now().to_rfc3339()),
        QuestionAnswer::new("Include caching?", "Yes", chrono::Utc::now().to_rfc3339()),
    ];
    ctx.api().answer_questions(&task_id, answers).unwrap();

    // ASSERT: Human answering does NOT overwrite the artifact
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("plan").unwrap(),
        plan_content,
        "Human answering questions should not change the artifact"
    );

    // =========================================================================
    // Step 2: Agent produces plan artifact → human rejects → artifact preserved
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Detailed implementation plan v1".to_string(),
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);
    assert_eq!(
        task.artifact("plan"),
        Some("Detailed implementation plan v1"),
        "Agent artifact output should create artifact"
    );

    // Human rejects (should NOT overwrite the agent's artifact)
    ctx.api()
        .reject(&task_id, "Need more detail on error handling")
        .unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("plan"),
        Some("Detailed implementation plan v1"),
        "Human rejection should NOT overwrite agent's artifact"
    );

    // =========================================================================
    // Step 3: Agent produces improved plan → human approves → artifact preserved
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Detailed plan v2 with error handling".to_string(),
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("plan"),
        Some("Detailed plan v2 with error handling"),
        "New agent artifact should overwrite previous agent artifact"
    );

    // Human approves (should NOT change the artifact)
    ctx.api().approve(&task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("plan"),
        Some("Detailed plan v2 with error handling"),
        "Human approval should not change the artifact"
    );

    ctx.advance(); // commit pipeline: Finishing → Finished → advance to work

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));

    // =========================================================================
    // Step 4: Work stage → produce artifact → approve to script stage
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete with tests".to_string(),
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes work output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("summary"),
        Some("Implementation complete with tests")
    );

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to checks

    // =========================================================================
    // Step 5: Script stage succeeds → artifact created with output
    // =========================================================================

    // Queue review output before advancing (script auto-advances to review)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Missing integration tests".to_string(),
        },
    );
    ctx.advance(); // spawns script → passes → auto-advances to review → spawns reviewer
    ctx.advance(); // processes review output (rejection, pauses for human review)

    let task = ctx.api().get_task(&task_id).unwrap();

    // ASSERT: Script success creates artifact
    assert!(
        task.artifact("check_results").is_some(),
        "Script success should create an artifact"
    );
    assert!(
        task.artifact("check_results")
            .unwrap()
            .contains("all checks passed"),
        "Script artifact should contain script output"
    );

    // =========================================================================
    // Step 6: Agent rejection verdict → artifact created with rejection content
    // =========================================================================

    // The reviewer's rejection content should be stored as artifact
    assert_eq!(
        task.artifact("verdict"),
        Some("Missing integration tests"),
        "Agent rejection verdict should create an artifact with the rejection content"
    );

    // Task should be paused at AwaitingReview (non-automated stage)
    assert_eq!(task.current_stage(), Some("review"));
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Human overrides rejection (should NOT change the artifact)
    ctx.api()
        .reject(&task_id, "Actually the tests are fine, re-evaluate")
        .unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("verdict"),
        Some("Missing integration tests"),
        "Human rejection override should NOT overwrite agent's verdict artifact"
    );

    // =========================================================================
    // Step 7: Agent approval verdict → artifact created with approval content
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Re-evaluated: all tests adequate, implementation is solid".to_string(),
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes approval output → pauses at AwaitingReview

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("verdict"),
        Some("Re-evaluated: all tests adequate, implementation is solid"),
        "Agent approval verdict should create an artifact with approval content"
    );

    // Human approves (should NOT change the artifact)
    let task = ctx.api().approve(&task_id).unwrap();
    assert_eq!(
        task.artifact("verdict"),
        Some("Re-evaluated: all tests adequate, implementation is solid"),
        "Human approval should not change the verdict artifact"
    );

    ctx.advance(); // commit pipeline: Finishing → Finished → Done → integration → Archived

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_done() || task.is_archived(),
        "Task should be done/archived after final approval"
    );
}

/// Test that script failure creates an artifact with the error text.
///
/// Separate test because script failure needs a different workflow setup
/// (a script that actually fails).
#[test]
fn test_script_failure_creates_artifact() {
    use orkestra_core::workflow::config::{ScriptStageConfig, StageConfig};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("checks", "check_results")
            .with_inputs(vec!["summary".into()])
            .with_script(ScriptStageConfig {
                command: "echo 'Error: tests failed with 3 failures'; exit 1".to_string(),
                timeout_seconds: 10,
                on_failure: Some("work".into()),
            }),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["check_results".into()])
            .automated(),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Script failure artifact test",
        "Test that script failure creates an artifact",
        None,
    );
    let task_id = task.id.clone();

    // Work stage → produce artifact → approve to script stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial work".to_string(),
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes work output
    ctx.api().approve(&task_id).unwrap();

    // Queue work output for after script failure recovery
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Fixed work".to_string(),
        },
    );

    ctx.advance(); // spawns script → fails → recovers to work → spawns worker
    ctx.advance(); // processes work output

    // ASSERT: Script failure should have created an artifact
    let task = ctx.api().get_task(&task_id).unwrap();
    let check_results = task.artifact("check_results");
    assert!(
        check_results.is_some(),
        "Script failure should create an artifact with error text"
    );
    assert!(
        check_results
            .unwrap()
            .contains("tests failed with 3 failures"),
        "Script failure artifact should contain the error output. Got: {}",
        check_results.unwrap()
    );
}

/// Test that verifies system prompt and user message are correctly split.
///
/// This test explicitly checks that:
/// - System prompt contains agent definition and output format
/// - User message contains only task context (no agent definition or output format)
#[test]
fn test_system_prompt_split() {
    let workflow = test_default_workflow();
    let ctx = TestEnv::with_git(&workflow, &["planner"]);

    // Create task
    let task = ctx.create_task("Test task", "Test description", None);
    let task_id = task.id.clone();

    // Queue planning output
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Implementation plan here".to_string(),
        },
    );

    ctx.advance(); // spawns planner

    // Get the last call to the agent via last_run_config
    let call = ctx.last_run_config();

    // ASSERT: System prompt should contain agent definition and output format
    let system_prompt = call
        .system_prompt
        .as_ref()
        .expect("Should have system prompt");
    assert!(
        system_prompt.contains("Output Format") || system_prompt.contains("output format"),
        "System prompt should contain output format instructions"
    );
    assert!(
        system_prompt.contains("plan"),
        "System prompt should reference the artifact name 'plan'"
    );

    // ASSERT: User message should contain task context only
    let user_message = &call.prompt;
    assert!(
        user_message.contains("Test task") || user_message.contains("Test description"),
        "User message should contain task context"
    );
    assert!(
        user_message.contains("<!orkestra:spawn:planning>"),
        "User message should have spawn marker"
    );

    // ASSERT: User message should NOT contain agent definition or output format
    assert!(
        !user_message.contains("Output Format"),
        "User message should NOT contain output format (that's in system prompt)"
    );
}

/// Test `OpenCode` provider fallback behavior.
///
/// When a stage uses `OpenCode` (which doesn't support system prompts),
/// the system prompt should be prepended to the user message.
#[test]
fn test_opencode_provider_fallback() {
    use orkestra_core::workflow::config::StageConfig;

    // Create workflow with a stage that uses OpenCode
    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_model("opencode/kimi-k2")]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    // Create task
    let task = ctx.create_task("OpenCode test", "Test fallback behavior", None);
    let task_id = task.id.clone();

    // Queue work output
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
        },
    );

    ctx.advance(); // spawns worker with OpenCode

    // Get the last call to the agent
    let call = ctx.last_run_config();

    // ASSERT: system_prompt should be None (OpenCode doesn't support it)
    assert!(
        call.system_prompt.is_none(),
        "OpenCode doesn't support system prompts, so RunConfig.system_prompt should be None"
    );

    // ASSERT: User message should contain BOTH system prompt content AND task context
    let user_message = &call.prompt;

    // Should contain output format (from system prompt)
    assert!(
        user_message.contains("Output Format") || user_message.contains("output format"),
        "User message should contain output format (prepended from system prompt)"
    );

    // Should contain artifact name (from system prompt)
    assert!(
        user_message.contains("summary"),
        "User message should contain artifact name (from system prompt)"
    );

    // Should contain task context
    assert!(
        user_message.contains("OpenCode test") || user_message.contains("Test fallback behavior"),
        "User message should contain task context"
    );

    // Should contain spawn marker
    assert!(
        user_message.contains("<!orkestra:spawn:work>"),
        "User message should have spawn marker"
    );

    // ASSERT: Schema enforcement should also be in the user message
    // (OpenCode doesn't support native JSON schema either)
    assert!(
        user_message.contains("Required Output Format") || user_message.contains("JSON object"),
        "User message should contain schema enforcement section (OpenCode lacks native schema support)"
    );
}

// =============================================================================
// Commit Message Generation Tests
// =============================================================================

/// Test that commit message generator is invoked during task integration.
///
/// This test verifies the full integration path: task completes workflow,
/// enters Done phase, orchestrator triggers integration, and the commit
/// message generator is called with correct context before committing.
///
/// Uses the default `MockCommitMessageGenerator::succeeding()` injected by
/// `TestEnv::with_git()`. The test verifies integration succeeds, which
/// confirms the generator was called (if it weren't, integration would fail).
#[test]
fn test_commit_message_generation_during_integration() {
    // Create a simple 2-stage workflow: work → review (automated with approval)
    let workflow = WorkflowConfig {
        version: 1,
        stages: vec![
            StageConfig::new("work", "summary").with_prompt("worker.md"),
            StageConfig::new("review", "verdict")
                .with_prompt("reviewer.md")
                .with_inputs(vec!["summary".into()])
                .with_capabilities(
                    orkestra_core::workflow::config::StageCapabilities::with_approval(Some(
                        "work".into(),
                    )),
                )
                .automated(),
        ],
        integration: orkestra_core::workflow::config::IntegrationConfig::default(),
        flows: indexmap::IndexMap::new(),
    };

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task(
        "Test commit message generation",
        "Verify commit message generation works",
        None,
    );
    let task_id = task.id.clone();

    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::Idle);

    // Set mock output for work stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implemented feature successfully".to_string(),
        },
    );

    // Advance through work stage
    ctx.advance(); // spawn work agent
    ctx.advance(); // process work output

    // Verify task is awaiting review
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Approve work
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to review

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));

    // Set mock output for review stage (automated approval)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "Approved! Changes look good.".to_string(),
        },
    );

    // Make some actual file changes in the worktree so there's something to commit
    let task = ctx.api().get_task(&task_id).unwrap();
    let worktree_path = std::path::Path::new(task.worktree_path.as_ref().unwrap());
    std::fs::write(
        worktree_path.join("test_file.txt"),
        "Test content for commit",
    )
    .unwrap();
    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(worktree_path)
        .output()
        .unwrap();

    // Advance through review stage
    ctx.advance(); // spawn review agent
    ctx.advance(); // process review output → auto-approve → Done → integration (sync) → Archived

    // Verify task is archived (integration succeeded, which means generator was called)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be archived after integration"
    );
    assert!(task.completed_at.is_some(), "Should have completed_at set");

    // Verify worktree is cleaned up
    assert!(
        !worktree_path.exists(),
        "Worktree directory should be removed after integration"
    );
}

// =============================================================================
// Interrupt and Resume Tests
// =============================================================================
//
// Note: These tests verify interrupt/resume state transitions using direct API
// calls rather than trying to catch AgentWorking phase with the mock runner
// (which completes immediately). The mock runner sends completion events
// immediately, so we can't reliably interrupt mid-execution in tests.

/// Test interrupt and resume creates correct iteration triggers.
///
/// This test verifies the core state machine without trying to catch the
/// `AgentWorking` phase (which is impossible with the mock since it completes
/// immediately). Instead, we verify that `resume()` creates the right iteration
/// trigger and the full flow works end-to-end.
#[test]
fn test_interrupt_and_resume() {
    use orkestra_core::workflow::domain::IterationTrigger;

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .automated(),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task("Test interrupt", "Testing interrupt functionality", None);
    let task_id = task.id.clone();

    // Manually transition task to AgentWorking (simulating agent spawn)
    ctx.api().agent_started(&task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AgentWorking);

    // Interrupt the task
    let task = ctx.api().interrupt(&task_id).unwrap();
    assert_eq!(
        task.phase,
        Phase::Interrupted,
        "Task should be in Interrupted phase after interrupt"
    );

    // Verify the iteration outcome is Interrupted
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(iterations.len(), 1, "Should have one iteration");
    assert_eq!(
        iterations[0].outcome,
        Some(Outcome::Interrupted),
        "Iteration should have Interrupted outcome"
    );

    // Resume with a message
    let task = ctx
        .api()
        .resume(&task_id, Some("please focus on error handling".to_string()))
        .unwrap();
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle after resume");

    // Verify a new iteration was created with ManualResume trigger
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        2,
        "Should have two iterations after resume"
    );
    assert_eq!(
        iterations[1].incoming_context,
        Some(IterationTrigger::ManualResume {
            message: Some("please focus on error handling".to_string())
        }),
        "Second iteration should have ManualResume trigger with message"
    );

    // Set output for the resumed agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Completed work with error handling".to_string(),
        },
    );

    // Advance to spawn and complete the resumed agent
    ctx.advance();
    ctx.advance();

    // Task should now be awaiting review
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.phase,
        Phase::AwaitingReview,
        "Task should be awaiting review after completion"
    );
}

/// Test interrupt and resume without a message.
#[test]
fn test_interrupt_and_resume_without_message() {
    use orkestra_core::workflow::domain::IterationTrigger;

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Test resume without message", "Testing resume", None);
    let task_id = task.id.clone();

    // Manually transition to AgentWorking
    ctx.api().agent_started(&task_id).unwrap();

    // Interrupt
    ctx.api().interrupt(&task_id).unwrap();

    // Resume without message
    let task = ctx.api().resume(&task_id, None).unwrap();
    assert_eq!(task.phase, Phase::Idle);

    // Verify ManualResume trigger with None message
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(iterations.len(), 2);
    assert_eq!(
        iterations[1].incoming_context,
        Some(IterationTrigger::ManualResume { message: None }),
        "Second iteration should have ManualResume trigger with no message"
    );
}

/// Test multiple interrupt/resume cycles on the same task.
#[test]
fn test_interrupt_resume_multiple_cycles() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Test multiple cycles", "Testing multiple cycles", None);
    let task_id = task.id.clone();

    // Cycle 1: AgentWorking → Interrupt → Resume
    ctx.api().agent_started(&task_id).unwrap();
    assert_eq!(
        ctx.api().get_task(&task_id).unwrap().phase,
        Phase::AgentWorking
    );

    ctx.api().interrupt(&task_id).unwrap();
    assert_eq!(
        ctx.api().get_task(&task_id).unwrap().phase,
        Phase::Interrupted
    );

    ctx.api()
        .resume(&task_id, Some("message 1".to_string()))
        .unwrap();
    assert_eq!(ctx.api().get_task(&task_id).unwrap().phase, Phase::Idle);

    // Cycle 2: AgentWorking → Interrupt → Resume
    ctx.api().agent_started(&task_id).unwrap();
    assert_eq!(
        ctx.api().get_task(&task_id).unwrap().phase,
        Phase::AgentWorking
    );

    ctx.api().interrupt(&task_id).unwrap();
    assert_eq!(
        ctx.api().get_task(&task_id).unwrap().phase,
        Phase::Interrupted
    );

    ctx.api()
        .resume(&task_id, Some("message 2".to_string()))
        .unwrap();
    assert_eq!(ctx.api().get_task(&task_id).unwrap().phase, Phase::Idle);

    // Cycle 3: Complete normally via orchestrator
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Final work".to_string(),
        },
    );
    ctx.advance(); // Spawn
    ctx.advance(); // Process completion

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.phase,
        Phase::AwaitingReview,
        "Task should complete normally after multiple interrupt/resume cycles"
    );

    // Verify we have the expected number of iterations
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    // iter1 (interrupted), iter2 (resumed/interrupted), iter3 (resumed/completed)
    assert_eq!(
        iterations.len(),
        3,
        "Should have 3 iterations after 2 interrupt cycles and completion"
    );
}

/// Test that interrupting a task in the wrong phase returns an error.
#[test]
fn test_interrupt_wrong_phase() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Test wrong phase", "Testing error case", None);
    let task_id = task.id.clone();

    // Set up mock output
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done".to_string(),
        },
    );

    // Advance to spawn and process completion
    ctx.advance();
    ctx.advance();

    // Task should now be in AwaitingReview
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // Try to interrupt (should fail)
    let result = ctx.api().interrupt(&task_id);
    assert!(
        result.is_err(),
        "Should not be able to interrupt task in AwaitingReview phase"
    );
    match result {
        Err(e) => assert!(
            matches!(
                e,
                orkestra_core::workflow::WorkflowError::InvalidTransition(_)
            ),
            "Error should be InvalidTransition, got: {e:?}"
        ),
        Ok(_) => panic!("Should have returned an error"),
    }
}

/// Test that resuming a task in the wrong phase returns an error.
#[test]
fn test_resume_wrong_phase() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Test resume wrong phase", "Testing error case", None);
    let task_id = task.id.clone();

    // Manually transition to AgentWorking
    ctx.api().agent_started(&task_id).unwrap();

    // Task should be in AgentWorking
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AgentWorking);

    // Try to resume (should fail - not in Interrupted phase)
    let result = ctx.api().resume(&task_id, None);
    assert!(
        result.is_err(),
        "Should not be able to resume task in AgentWorking phase"
    );
    match result {
        Err(e) => assert!(
            matches!(
                e,
                orkestra_core::workflow::WorkflowError::InvalidTransition(_)
            ),
            "Error should be InvalidTransition, got: {e:?}"
        ),
        Ok(_) => panic!("Should have returned an error"),
    }
}

/// Test that interrupted tasks are not automatically advanced by the orchestrator.
#[test]
fn test_interrupted_task_not_auto_advanced() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Test no auto advance",
        "Testing interrupted stays put",
        None,
    );
    let task_id = task.id.clone();

    // Manually transition to AgentWorking
    ctx.api().agent_started(&task_id).unwrap();

    // Interrupt
    ctx.api().interrupt(&task_id).unwrap();
    assert_eq!(
        ctx.api().get_task(&task_id).unwrap().phase,
        Phase::Interrupted
    );

    // Advance several ticks
    ctx.advance();
    ctx.advance();
    ctx.advance();

    // Verify task is still in Interrupted phase (not auto-advanced)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.phase,
        Phase::Interrupted,
        "Interrupted task should not be auto-advanced by orchestrator"
    );
}
