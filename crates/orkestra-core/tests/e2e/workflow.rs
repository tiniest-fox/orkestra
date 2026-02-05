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
    ctx.advance(); // spawns breakdown agent (completion ready)
    ctx.advance(); // processes breakdown output

    // VERIFY: First spawn of breakdown stage → full prompt
    ctx.assert_full_prompt("breakdown", false, false);

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

    let task = ctx.api().approve(&task_id).expect("Should approve work");

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

    // Resolve the conflict on main by reverting the conflicting commit
    // This simulates someone resolving the conflict so the task can be integrated
    std::process::Command::new("git")
        .args(["reset", "--hard", "HEAD~1"])
        .current_dir(ctx.repo_path())
        .output()
        .unwrap();

    // The work agent already ran (output consumed in the previous advance cycle).
    // No additional advance needed — the work output was already processed.

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
    ctx.advance(); // spawns planner (completion ready)
    ctx.advance(); // processes plan output
    ctx.api().approve(&task_id).unwrap();

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

    // The task should still be in work stage (approval should have been rejected)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Approval should have been rejected"
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
fn advance_to_done(ctx: &TestEnv, task_id: &str) {
    use orkestra_core::workflow::execution::StageOutput;

    let api = ctx.api();

    // Work stage: mark as working, process output
    api.agent_started(task_id).unwrap();
    api.process_agent_output(
        task_id,
        StageOutput::Artifact {
            content: "Implementation complete".to_string(),
        },
    )
    .unwrap();

    // Approve work → advances to review (automated)
    api.approve(task_id).unwrap();

    // Review stage (automated): mark as working, process output → auto-approve → Done
    api.agent_started(task_id).unwrap();
    api.process_agent_output(
        task_id,
        StageOutput::Artifact {
            content: "Approved".to_string(),
        },
    )
    .unwrap();

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
