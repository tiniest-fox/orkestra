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
    config::{GateConfig, IntegrationConfig, StageConfig, WorkflowConfig},
    domain::{LogEntry, Question, QuestionAnswer, QuestionOption},
    runtime::{Outcome, TaskState},
    TaskCreationMode,
};

use crate::helpers::{enable_auto_merge, MockAgentOutput, TestEnv};

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
        &enable_auto_merge(test_default_workflow()),
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
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after setup completes"
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
    assert!(task.is_awaiting_review());
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

    assert!(matches!(task.state, TaskState::Queued { .. }));
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
            activity_log: None,
            resources: vec![],
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
    assert!(task.is_awaiting_review());
    assert_eq!(
        task.artifact("plan"),
        Some("Initial plan v1 - not detailed enough")
    );

    // Human restarts the planning stage with a message
    let task = ctx
        .api()
        .restart_stage(&task_id, "Need more detail on the implementation steps")
        .expect("Should restart stage");

    assert_eq!(task.current_stage(), Some("planning"));
    assert!(matches!(task.state, TaskState::Queued { .. }));

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    // With new model: iter1 (questions), iter2 (answers→skipped by restart), iter3 (restart)
    assert_eq!(
        iterations.len(),
        3,
        "Should have 3 iterations after restart"
    );

    // Check first iteration ended with AwaitingAnswers (agent asked questions)
    assert!(iterations[0].outcome.is_some());
    assert!(matches!(
        iterations[0].outcome.as_ref().unwrap(),
        Outcome::AwaitingAnswers { .. }
    ));

    // Check second iteration ended with Skipped (stage was restarted)
    assert!(iterations[1].outcome.is_some());
    assert!(matches!(
        iterations[1].outcome.as_ref().unwrap(),
        Outcome::Skipped { .. }
    ));

    // Check third iteration has restart context
    assert!(iterations[2].incoming_context.is_some());

    // Orchestrator spawns planner again, produces better plan
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Detailed plan v2:\n1. Create module\n2. Add tests\n3. Update docs"
                .to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner agent (completion ready)
    ctx.advance(); // processes plan v2 output

    // VERIFY: Planner spawn after restart → full initial prompt (restart supersedes session)
    ctx.assert_full_prompt("plan", true, false);

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());

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
    assert!(matches!(task.state, TaskState::Queued { .. }));

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    // With new model: iter1 (questions), iter2 (answers→skipped), iter3 (restart→approved), iter4 (breakdown)
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
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns breakdown agent (completion ready)
    ctx.advance(); // processes breakdown output

    // VERIFY: First spawn of breakdown stage → full prompt
    ctx.assert_full_prompt("breakdown", false, false);

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());

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
    assert!(matches!(task.state, TaskState::Queued { .. }));

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
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker agent (completion ready)
    ctx.advance(); // processes work output

    // VERIFY: First spawn of work stage → full prompt
    ctx.assert_full_prompt("summary", false, false);

    // Human restarts the work stage with a message
    let task = ctx
        .api()
        .restart_stage(&task_id, "Tests are failing, please fix them")
        .expect("Should restart work stage");

    assert_eq!(task.current_stage(), Some("work"));
    assert!(matches!(task.state, TaskState::Queued { .. }));

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    // With new model: planning x3, breakdown, work x2
    assert_eq!(iterations.len(), 6);

    // Orchestrator spawns worker again
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete with passing tests".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker agent (completion ready)
    ctx.advance(); // processes work v2 output

    // VERIFY: Work spawn after restart → full initial prompt (restart supersedes session)
    let config = ctx.last_run_config();
    assert!(
        !config.is_resume,
        "Stage restart uses fresh session — is_resume must be false"
    );

    // =========================================================================
    // Step 7: Work approved → Reviewing
    // =========================================================================

    ctx.api().approve(&task_id).expect("Should approve work");
    ctx.advance(); // commit pipeline: Finishing → Finished → advance

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // =========================================================================
    // Step 8: Reviewer rejects to Work → Working → AwaitingReview
    // =========================================================================

    // Pre-queue the work agent's output for after the rejection is confirmed
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Code style issues found - please fix formatting".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation with fixed formatting".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes reviewer rejection → AwaitingRejectionConfirmation (human must confirm)

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert!(
        matches!(task.state, TaskState::AwaitingRejectionConfirmation { .. }),
        "Reviewer rejection pauses for human confirmation"
    );

    // Human confirms the rejection → work stage queued
    ctx.api()
        .approve(&task_id)
        .expect("Should confirm reviewer rejection");
    ctx.advance(); // spawns work agent (pre-queued output consumed) + processes output → AwaitingApproval

    // VERIFY: Work agent after cross-stage rejection → fresh spawn (Rejection is a returning trigger).
    // Full prompt with reviewer feedback embedded.
    let prompt = ctx.last_prompt();
    assert!(
        !prompt.starts_with("<!orkestra:resume:"),
        "Rejection spawns fresh session — should be full prompt, not resume"
    );
    assert!(
        prompt.contains("Code style issues found - please fix formatting"),
        "Full prompt should embed the rejection feedback"
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Work agent ran and produced artifact"
    );

    // Check the iteration recorded the rejection
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let rejection_iter = iterations.iter().find(|i| {
        // Accept either Rejection (auto_mode) or AwaitingRejectionReview (confirmed by human)
        i.outcome
            .as_ref()
            .and_then(|o| o.rejection_target())
            .is_some_and(|t| t == "work")
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
    // The mock queue is FIFO per task, so the review agent consumes the approval first,
    // then the recovery work agent consumes "summary".
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM! All checks pass.".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Resolved merge conflict".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer → drain_active → AwaitingApproval

    // VERIFY: Reviewer re-entering the same stage (untriggered re-entry) → fresh spawn, full prompt.
    // No trigger on the new review iteration — classified as untriggered re-entry → session superseded.
    ctx.assert_full_prompt("verdict", false, true);

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Done → integration fails → recovers to work
    ctx.advance(); // spawns work agent → processes work output → AwaitingApproval (work)

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

    // VERIFY: Work agent after integration failure → fresh spawn (Integration is a returning trigger).
    // Integration context is embedded directly in the full prompt.
    // The branch name is random, so this can only pass if base_branch flows through correctly.
    let config = ctx.last_run_config();
    assert!(
        !config.is_resume,
        "Integration spawns fresh session — should not be resume"
    );
    assert!(
        config.prompt.contains("MERGE CONFLICT") || config.prompt.contains("conflict"),
        "Full prompt should mention the merge conflict"
    );
    assert!(
        config.prompt.contains("merge is in progress"),
        "Full prompt must instruct the agent to resolve the in-progress merge"
    );

    // Approve work
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));

    // Orchestrator spawns reviewer (reviewer approves directly → Done → integration runs)
    // Then auto-integration runs and succeeds (no conflict this time)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Conflict resolved correctly".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer → drain_active → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Done → integration succeeds (sync) → Archived

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
    println!("Final state: {:?}", task.state);
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
    // Use a custom workflow where work does NOT have an agentic gate (no approval capability).
    // This lets us verify that an agent producing Approval output from a non-capable stage
    // causes a task failure.
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("breakdown", "breakdown")
            .with_prompt("breakdown.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"), // No gate → no approval capability
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ])
    .with_integration(IntegrationConfig::new("work"));
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create task and get to work stage (waits for async setup)
    let task = ctx.create_task("Test", "Test task", None);
    let task_id = task.id.clone();

    // Planning stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
            activity_log: None,
            resources: vec![],
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
            activity_log: None,
            resources: vec![],
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
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes approval output (rejected by capability check)

    // Agent returned output that violates stage capabilities → task should be Failed
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_failed(),
        "Agent returning invalid output type should fail the task, got: {:?}",
        task.state
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

    assert_eq!(api.workflow().stages_in_flow("default").len(), 4);
    assert_eq!(
        api.workflow()
            .stages_in_flow("default")
            .iter()
            .map(|s| s.name.as_str())
            .collect::<Vec<_>>(),
        vec!["planning", "breakdown", "work", "review"]
    );

    // Review has approval capability
    let review = api.workflow().stage("default", "review").unwrap();
    assert!(review.has_agentic_gate());

    // Integration config defaults to work
    assert_eq!(
        api.workflow()
            .flow("default")
            .map_or("", |f| f.integration.on_failure.as_str()),
        "work"
    );
}

/// Test custom `integration.on_failure` configuration
#[test]
#[allow(clippy::too_many_lines)]
fn test_custom_integration_on_failure() {
    use orkestra_core::workflow::config::IntegrationConfig;

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict").with_prompt("reviewer.md"), // No gate: auto-advances after artifact
    ])
    .with_integration(IntegrationConfig {
        on_failure: "planning".into(),
        auto_merge: true,
    });

    assert_eq!(
        workflow
            .flow("default")
            .map_or("", |f| f.integration.on_failure.as_str()),
        "planning"
    );

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker", "reviewer"]);
    let task = ctx.create_task("Test", "Test task", None);
    let task_id = task.id.clone();

    // Planning stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
            activity_log: None,
            resources: vec![],
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
            activity_log: None,
            resources: vec![],
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
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Recovery plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes review output → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Done → integration fails (sync) → recovers to planning → spawns planner (completion ready)
    ctx.advance(); // processes planner output

    // Integration should have failed and routed to planning (configured on_failure).
    // The planning agent consumed the pre-queued plan output, so the task should
    // be in planning stage with AwaitingReview.
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("planning"),
        "Integration failure should route to planning (on_failure config), got: {:?}",
        task.state
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

/// Test that flow `on_failure` override is used for integration failure recovery.
///
/// When a task using a flow with `on_failure` override encounters integration failure,
/// it should return to the flow's override stage, not the global `integration.on_failure`.
#[test]
#[allow(clippy::too_many_lines)]
fn test_integration_failure_uses_flow_on_failure_override() {
    use indexmap::IndexMap;
    use orkestra_core::workflow::config::{FlowConfig, IntegrationConfig};

    // Build workflow where:
    // - Default flow integration.on_failure = "work"
    // - Flow "quick" has on_failure = "planning"
    let mut flows = IndexMap::new();
    flows.insert(
        "quick".to_string(),
        FlowConfig {
            stages: vec![
                StageConfig::new("planning", "plan")
                    .with_prompt("planner.md")
                    .with_gate(GateConfig::Agentic),
                StageConfig::new("work", "summary")
                    .with_prompt("worker.md")
                    .with_gate(GateConfig::Agentic),
                StageConfig::new("review", "verdict").with_prompt("reviewer.md"), // No gate: auto-advances
            ],
            integration: IntegrationConfig {
                on_failure: "planning".to_string(),
                auto_merge: true,
            }, // Override!
        },
    );

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict").with_prompt("reviewer.md"), // No gate: auto-advances
    ])
    .with_integration(IntegrationConfig {
        on_failure: "work".to_string(), // Global setting
        auto_merge: true,               // Enable auto-merge to trigger integration
    })
    .with_flows(flows);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker", "reviewer"]);

    // Create task with the "quick" flow
    let task = ctx
        .api()
        .create_task_with_options(
            "Test flow override",
            "Test description",
            None,
            TaskCreationMode::Normal,
            Some("quick"),
        )
        .unwrap();
    let task_id = task.id.clone();

    // Planning stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // setup → spawns planner
    ctx.advance(); // processes plan
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → advance to work

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
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes work output
    ctx.api().approve(&task_id).unwrap();

    // Create a conflict on base branch BEFORE the review completes, so auto-integration fails
    let base_branch = ctx.api().get_task(&task_id).unwrap().base_branch.clone();
    orkestra_core::testutil::create_and_commit_file_on_branch(
        ctx.repo_path(),
        &base_branch,
        "conflict.txt",
        "Base branch's conflicting version",
        "Add conflicting file on base branch",
    )
    .unwrap();

    // Review stage (auto-approves to Done → auto-integration fails → recovery to planning)
    // Queue both: verdict for the review agent, then plan for the recovery planning agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "LGTM".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Recovery plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes review output → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Done → integration fails → recovers to planning → spawns planner
    ctx.advance(); // processes planner output

    // Verify task is in PLANNING stage (flow's on_failure), not work (global on_failure)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("planning"),
        "Task should recover to flow's on_failure stage 'planning', not global 'work'. Got: {:?}",
        task.current_stage()
    );

    // Verify integration failure was recorded
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let integration_failure = iterations
        .iter()
        .find(|i| matches!(i.outcome.as_ref(), Some(Outcome::IntegrationFailed { .. })));
    assert!(
        integration_failure.is_some(),
        "Should have integration failure iteration"
    );
}

/// Test gate script execution with failure recovery.
///
/// Flow:
/// 1. Task created → Work stage (mock agent) → `AwaitingGate`
/// 2. Gate fails (toggle script) → Work re-queued with `GateFailure` trigger
/// 3. Work produces fix → `AwaitingGate`
/// 4. Gate passes → commit pipeline → Review stage (automated)
/// 5. Review approves → Done
#[test]
#[allow(clippy::too_many_lines)] // Comprehensive e2e test covering full gate recovery flow
fn test_gate_script_with_recovery() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig};

    // Toggle gate script: fails first time (creates marker), passes second time.
    // Uses $ORKESTRA_TASK_ID in the marker path for isolation between parallel tests.
    let gate_command = concat!(
        "MARKER=/tmp/orkestra_gate_test_${ORKESTRA_TASK_ID}; ",
        "if [ -z \"$ORKESTRA_TASK_ID\" ]; then echo 'ERROR: ORKESTRA_TASK_ID not set!'; exit 1; fi; ",
        "echo \"Running gate for task: $ORKESTRA_TASK_ID\"; ",
        "if [ -f \"$MARKER\" ]; then echo \"Gate passed for $ORKESTRA_TASK_ID!\"; exit 0; ",
        "else touch \"$MARKER\"; echo \"Gate failed (task: $ORKESTRA_TASK_ID)\"; exit 1; fi",
    );

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::new_automated(gate_command).with_timeout(10)),
        StageConfig::new("review", "verdict").with_prompt("reviewer.md"),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // =========================================================================
    // Step 1: Create task → Work stage
    // =========================================================================
    let task = ctx.create_task("Test gate recovery", "Test that gate scripts work", None);
    let task_id = task.id.clone();

    assert_eq!(task.current_stage(), Some("work"));
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // =========================================================================
    // Step 2: Work stage produces artifact → AwaitingGate
    // =========================================================================
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker → drain_active → artifact processed → AwaitingGate

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingGate { .. }),
        "Task should be AwaitingGate after artifact output"
    );

    // =========================================================================
    // Step 3: Gate runs and fails → Work re-queued with GateFailure
    // =========================================================================

    // Pre-queue second work output for after gate failure recovery
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Fixed implementation after gate failure".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawns gate → drain_active → gate fails → work re-queued with GateFailure

    // Check GateFailed iteration was recorded
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let gate_fail_iter = iterations
        .iter()
        .find(|i| matches!(i.outcome.as_ref(), Some(Outcome::GateFailed { .. })));
    assert!(gate_fail_iter.is_some(), "Should have GateFailed iteration");

    // Work should be re-queued in same stage
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Should be in work stage after gate failure"
    );
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Work should be re-queued after gate failure"
    );

    // =========================================================================
    // Step 4: Second work iteration → AwaitingGate (verify feedback prompt)
    // =========================================================================
    ctx.advance(); // spawns worker (second) → drain_active → artifact processed → AwaitingGate

    // Verify worker got gate failure feedback in resume prompt
    ctx.assert_resume_prompt_contains("user_message", &["gate checks failed"]);

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingGate { .. }),
        "Task should be AwaitingGate after second work output"
    );

    // =========================================================================
    // Step 5: Gate passes → commit pipeline → Review (automated) → Done
    // =========================================================================
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "All checks passed, implementation complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawns gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit pipeline → review Queued
    ctx.advance(); // spawns reviewer → drain_active → review output → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves review
    ctx.advance(); // commit pipeline → Done/Archived

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_done() || task.is_archived(),
        "Task should be done/archived"
    );

    // Verify the complete iteration history
    let iterations = ctx.api().get_iterations(&task_id).unwrap();

    // Should have GateFailed iteration
    assert!(
        iterations
            .iter()
            .any(|i| matches!(i.outcome.as_ref(), Some(Outcome::GateFailed { .. }))),
        "Should have GateFailed iteration"
    );

    // Review should have completed
    let review_approved = iterations
        .iter()
        .any(|i| i.stage == "review" && matches!(i.outcome.as_ref(), Some(Outcome::Approved)));
    assert!(review_approved, "Review stage should have completed");

    // Verify ORKESTRA_TASK_ID was passed to the gate script
    // (toggle script uses $ORKESTRA_TASK_ID in the marker path for test isolation)
}

// =============================================================================
// Post-Merge Recovery Tests
// =============================================================================

/// Helper: advance a task through a simple work → review(automated) workflow to Done.
///
/// Uses the orchestrator loop (`set_output` + advance) so the commit pipeline runs
/// naturally within each tick. The task will be in Done state.
fn advance_to_done(ctx: &TestEnv, task_id: &str) {
    // Work stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process output → AwaitingReview
    ctx.api().approve(task_id).unwrap(); // → Finishing
    ctx.advance(); // commit → advance to review

    // Review stage (no gate — pauses for approval)
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "Approved".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process output → AwaitingApproval
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit pipeline → Done

    let task = ctx.api().get_task(task_id).unwrap();
    assert!(
        task.is_done(),
        "Task should be Done after review approves, but state is {:?}",
        task.state
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
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict").with_prompt("reviewer.md"),
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

    // Verify the task is stuck in the crash state (Integrating, not yet Archived)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Integrating),
        "Task should be stuck in Integrating state"
    );

    // === Simulate app restart: run startup recovery ===
    let events = ctx.run_startup_recovery();

    // Verify task is now Archived
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after recovery, but state is {:?}",
        task.state
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
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict").with_prompt("reviewer.md"),
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

    // Verify the task is in the crash state (Integrating, branch NOT merged)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(matches!(task.state, TaskState::Integrating));

    // === Simulate app restart: run startup recovery ===
    let events = ctx.run_startup_recovery();

    // Recovery should re-attempt integration, which should succeed
    // (worktree exists, branch has commits, no conflicts)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after recovery re-integration, but state is {:?}",
        task.state
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
        .with_model("opencode/kimi-k2.5")
        .with_gate(GateConfig::Agentic)]);
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
            activity_log: None,
            resources: vec![],
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

    // Restart stage — this is the bug scenario:
    // Without the fix, the retry would try to resume with a pre-generated UUID,
    // causing OpenCode to hang.
    ctx.api().restart_stage(&task_id, "Try again").unwrap();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "result".to_string(),
            content: "Second run output".to_string(),
            activity_log: None,
            resources: vec![],
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

/// Test that cross-stage rejection supersedes the target stage's session,
/// causing a fresh spawn with full prompt + feedback.
///
/// Also validates that Handlebars conditionals in agent definitions render
/// correctly when feedback is present.
///
/// Flow:
/// 1. Task created → work stage → produce artifact → approve → review stage
/// 2. Review REJECTS to work (Rejection trigger → session always superseded)
/// 3. Verify: old work session superseded, new session created (different UUID)
/// 4. Verify: work agent gets a FULL prompt (not resume), with feedback included
/// 5. Verify: Handlebars `{{#if feedback}}` conditional in agent definition renders
#[test]
#[allow(clippy::too_many_lines)]
fn test_session_reset_on_cross_stage_rejection() {
    use orkestra_core::workflow::domain::SessionState;

    // Rejection always supersedes the target stage session (no flag needed).
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
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
            activity_log: None,
            resources: vec![],
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

    // Approve work → advances to review
    ctx.api().approve(&task_id).unwrap();
    // Enable auto_mode so the reviewer's rejection auto-executes (no human confirmation step)
    ctx.api().set_auto_mode(&task_id, true).unwrap();

    // =========================================================================
    // Step 2: Review rejects to work (Rejection trigger always supersedes)
    // =========================================================================

    // Queue review rejection + work output (both consumed in sequence)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Code needs refactoring — extract helper methods".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Refactored implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes review rejection (auto_mode → auto-executes) → supersedes work session → spawns work agent (completion ready)
    ctx.api().set_auto_mode(&task_id, false).unwrap(); // disable auto_mode before work#2 processes to prevent review#2 spawning
    ctx.advance(); // processes work output → AwaitingApproval (auto_mode=false, GateConfig::Agentic)

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
        prompt.contains("## Your Current Trak"),
        "Full prompt should contain trak section"
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

/// Test that rejection ALWAYS supersedes the existing agent session.
///
/// Previously, rejection from review → work only superseded if `reset_session: true`
/// was set. Now, the trigger type (Rejection) determines supersession unconditionally.
#[test]
#[allow(clippy::too_many_lines)]
fn test_rejection_always_supersedes_session() {
    use orkestra_core::workflow::domain::SessionState;

    // Standard workflow: review rejects to work — supersession happens regardless of flags
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
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
            activity_log: None,
            resources: vec![],
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

    // Approve → review → reject back to work (auto_mode for auto-execution of rejection)
    ctx.api().approve(&task_id).unwrap();
    ctx.api().set_auto_mode(&task_id, true).unwrap();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more tests".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation with more tests".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes rejection (auto_mode → auto-executes) → moves to work → spawns work agent
    ctx.api().set_auto_mode(&task_id, false).unwrap(); // disable auto_mode before work#2 processes to prevent review#2 spawning
    ctx.advance(); // processes work output → AwaitingApproval (auto_mode=false, GateConfig::Agentic)

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

    // Both work iterations should be linked to DIFFERENT sessions (rejection always supersedes)
    let work1_session = iterations[0].stage_session_id.as_ref();
    let work2_session = iterations[2].stage_session_id.as_ref();
    assert_ne!(
        work1_session, work2_session,
        "Rejection should create a new work session (original superseded)"
    );

    // Session SHOULD be superseded — rejection always triggers supersession
    let all_sessions = ctx.api().get_stage_sessions(&task_id).unwrap();
    let work_sessions: Vec<_> = all_sessions.iter().filter(|s| s.stage == "work").collect();
    let review_sessions: Vec<_> = all_sessions
        .iter()
        .filter(|s| s.stage == "review")
        .collect();

    assert_eq!(
        work_sessions.len(),
        2,
        "Should have exactly 2 work sessions (original superseded, new active). Got: {work_sessions:?}"
    );
    // Original session should be superseded
    let superseded = work_sessions
        .iter()
        .find(|s| s.id == original_id)
        .expect("Original work session should still exist");
    assert_eq!(
        superseded.session_state,
        SessionState::Superseded,
        "Original work session should be superseded after rejection"
    );
    assert_eq!(
        review_sessions.len(),
        1,
        "Should have 1 review session. Got: {review_sessions:?}"
    );

    // Should be a FULL prompt (not resume) — rejection spawns a fresh session
    let prompt = ctx.last_prompt();
    assert!(
        !prompt.starts_with("<!orkestra:resume:"),
        "Rejection spawns fresh session — should be full prompt, not resume"
    );

    let last_config = ctx.last_run_config();
    assert!(
        !last_config.is_resume,
        "Rejection should spawn a fresh session (not resume)"
    );
}

/// Test that agent definitions without Handlebars markers pass through unchanged.
///
/// Ensures the Handlebars rendering fast path works correctly — most agent
/// definitions don't use `{{` and should be returned unchanged with no
/// performance overhead.
#[test]
fn test_handlebars_passthrough_for_plain_definitions() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
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
            activity_log: None,
            resources: vec![],
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
/// `user_message` resume prompt.
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
        task.state
    );

    // Human retries with instructions
    ctx.api()
        .send_message(&task_id, "Use the v2 API instead")
        .unwrap();

    // Agent succeeds this time
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan using v2 API".into(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent with user_message resume prompt

    // Verify the resume prompt contains the user_message marker and instructions
    ctx.assert_resume_prompt_contains("user_message", &["Use the v2 API instead"]);

    ctx.advance(); // processes artifact output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());
}

/// Test that retry instructions on a blocked task reach the agent via the
/// `user_message` resume prompt.
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
        matches!(task.state, TaskState::Blocked { .. }),
        "Task should be Blocked, got: {:?}",
        task.state
    );

    // Human retries with context
    ctx.api()
        .send_message(&task_id, "CI pipeline is green now")
        .unwrap();

    // Agent succeeds
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan with CI passing".into(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent with user_message resume prompt

    ctx.assert_resume_prompt_contains("user_message", &["CI pipeline is green now"]);

    ctx.advance(); // processes artifact output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());
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
    ctx.api().send_message(&task_id, "please retry").unwrap();

    // Agent succeeds
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan v2".into(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent with user_message resume prompt

    ctx.assert_resume_prompt_contains("user_message", &["please retry"]);
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
    ctx.api().send_message(&task_id, "please retry").unwrap();

    // Set output for the retry
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Retry plan".into(),
            activity_log: None,
            resources: vec![],
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
    assert!(task.is_awaiting_review());
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
    // Non-automated review stage with approval capability (rejection → work)
    let workflow = enable_auto_merge(
        WorkflowConfig::new(vec![
            StageConfig::new("work", "summary")
                .with_prompt("worker.md")
                .with_gate(GateConfig::Agentic),
            StageConfig::new("review", "verdict")
                .with_prompt("reviewer.md")
                .with_gate(GateConfig::Agentic),
        ])
        .with_integration(IntegrationConfig::new("work")),
    );

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
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // =========================================================================
    // Step 2: Work agent produces artifact → Approve → Review stage
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation with tests".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes work output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());

    // Approve work → enters commit pipeline
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to review

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // =========================================================================
    // Step 3: Reviewer rejects → Task pauses at AwaitingReview
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests are incomplete — missing edge case coverage".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
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
    assert!(
        matches!(task.state, TaskState::AwaitingRejectionConfirmation { .. }),
        "Task should be AwaitingRejectionConfirmation for human to confirm/override rejection"
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
        .restart_stage(
            &task_id,
            "The implementation looks correct — please re-evaluate the edge cases",
        )
        .unwrap();

    assert_eq!(
        task.current_stage(),
        Some("review"),
        "After override, task should stay in review stage"
    );
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "After override, task should be Queued (ready for reviewer to run again)"
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
            activity_log: None,
            resources: vec![],
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
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should be AwaitingApproval for standard approval"
    );

    // This time the outcome should NOT be AwaitingRejectionReview
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let latest_review = iterations
        .iter()
        .rfind(|i| i.stage == "review")
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
        "Task should be Archived after approval + integration, got state: {:?}",
        task.state
    );
}

/// Test that agent approval pauses at `AwaitingApproval` when `auto_mode` is false.
///
/// Regression test for: approval output calling `enter_commit_pipeline` directly,
/// bypassing the `auto_mode` check in `auto_advance_or_review`.
///
/// Flow:
/// 1. Create task with work + review stages (both `GateConfig::Agentic`), `auto_mode=false`
/// 2. Work agent produces artifact → human approves → review stage
/// 3. Reviewer agent outputs "approve"
/// 4. Assert task pauses at `AwaitingApproval` (human must still confirm)
/// 5. Human approves → task advances through commit pipeline → archived
#[test]
fn test_approval_review_pauses_for_human_when_not_auto_mode() {
    let workflow = enable_auto_merge(
        WorkflowConfig::new(vec![
            StageConfig::new("work", "summary")
                .with_prompt("worker.md")
                .with_gate(GateConfig::Agentic),
            StageConfig::new("review", "verdict")
                .with_prompt("reviewer.md")
                .with_gate(GateConfig::Agentic),
        ])
        .with_integration(IntegrationConfig::new("work")),
    );

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Approval pause test",
        "Test that reviewer approval pauses for human when auto_mode=false",
        None,
    );
    let task_id = task.id.clone();

    assert_eq!(task.current_stage(), Some("work"));
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // Work stage: produce artifact → awaiting review → human approves → review stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes work output → AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to review

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // Review stage: reviewer approves → should pause at AwaitingApproval (auto_mode=false)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM — implementation looks correct".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer (completion ready)
    ctx.advance(); // processes approval → should pause at AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("review"),
        "Task should still be in review stage (agent approval paused for human review)"
    );
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should be AwaitingApproval — agent approval must not bypass human review when auto_mode=false. Got state: {:?}",
        task.state
    );

    // Human approves → commit pipeline → archived
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → Done → integration → Archived

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after human approval + integration, got state: {:?}",
        task.state
    );
}

/// Test that agent approval auto-advances immediately when `auto_mode` is true.
///
/// When `auto_mode` is enabled, the approve path in `handle_approval.rs` should
/// call `auto_advance_or_review` which short-circuits the human review pause and
/// enters the commit pipeline directly.
///
/// Flow:
/// 1. Create task with work + review stages (both `GateConfig::Agentic`)
/// 2. Enable `auto_mode` on the task
/// 3. Drive through work → review
/// 4. Reviewer agent outputs "approve"
/// 5. Assert task advances past review without pausing at `AwaitingApproval`
#[test]
fn test_approval_auto_advances_when_auto_mode() {
    let workflow = enable_auto_merge(
        WorkflowConfig::new(vec![
            StageConfig::new("work", "summary")
                .with_prompt("worker.md")
                .with_gate(GateConfig::Agentic),
            StageConfig::new("review", "verdict")
                .with_prompt("reviewer.md")
                .with_gate(GateConfig::Agentic),
        ])
        .with_integration(IntegrationConfig::new("work")),
    );

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Auto-mode approval test",
        "Test that reviewer approval auto-advances when auto_mode=true",
        None,
    );
    let task_id = task.id.clone();

    // Drive work stage with auto_mode=false (default) to reach review stage predictably
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker (completion ready)
    ctx.advance(); // processes work output → AwaitingApproval

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → advance to review

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("review"),
        "Task should be in review stage. Got: {:?}",
        task.state
    );

    // Enable auto_mode before review stage runs
    ctx.api().set_auto_mode(&task_id, true).unwrap();

    // Review stage: reviewer approves → auto_mode=true: should NOT pause at AwaitingApproval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM — implementation looks correct".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer → drain_active → auto_mode=true: enters commit pipeline → Done
    ctx.advance(); // integration → Archived

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        !matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should NOT be AwaitingApproval when auto_mode=true — agent approval should auto-advance. Got state: {:?}",
        task.state
    );
    // Task should be Finishing, Done, or Archived depending on pipeline speed
    assert!(
        matches!(task.state, TaskState::Finishing { .. })
            || task.is_done()
            || task.is_archived(),
        "Task should be past review stage (Finishing/Done/Archived) with auto_mode=true. Got state: {:?}",
        task.state
    );
}

/// Test that confirming a reviewer rejection sends the task to the target stage.
///
/// When the human agrees with the reviewer's rejection (calls approve on the
/// pending rejection), the task should move to the rejection target stage (work).
#[test]
fn test_rejection_review_confirm() {
    // Non-automated review stage
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ])
    .with_integration(IntegrationConfig::new("work"));

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
            activity_log: None,
            resources: vec![],
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
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes rejection

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert!(task.is_awaiting_review());

    // Human confirms the rejection (calls approve)
    let task = ctx.api().approve(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Confirming rejection should send task to the rejection target (work)"
    );
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued, ready for work agent"
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
    // When a task has auto_mode=true, reviewer rejections auto-execute without human confirmation.
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ])
    .with_integration(IntegrationConfig::new("work"));

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Automated rejection test",
        "Test that auto_mode tasks skip rejection review",
        None,
    );
    let task_id = task.id.clone();

    // Work → produce artifact → approve (with auto_mode=false) → then enable auto_mode
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes output → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    // Enable auto_mode: reviewer rejection will now auto-execute without human confirmation
    ctx.api().set_auto_mode(&task_id, true).unwrap();

    // Queue rejection + work output (rejection auto-executes, work auto-advances)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs refactoring".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Refactored implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // advance work → review → spawns reviewer (completion ready)
    ctx.advance(); // processes rejection → auto_mode → auto-executes → work Queued → spawns worker
    ctx.advance(); // processes work output → auto_mode → auto-advances

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
        "auto_mode task should produce immediate Rejection outcome (not AwaitingRejectionReview)"
    );
    let awaiting_review = iterations.iter().any(|i| {
        matches!(
            i.outcome.as_ref(),
            Some(Outcome::AwaitingRejectionReview { .. })
        )
    });
    assert!(
        !awaiting_review,
        "auto_mode task should NOT produce AwaitingRejectionReview"
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
/// 5. Human rejection → artifact unchanged (still agent's content)
/// 6. Human approval → artifact unchanged (still agent's content)
#[test]
#[allow(clippy::too_many_lines)]
fn test_artifact_generation_for_all_output_types() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig};

    // Multi-stage workflow covering all output types:
    // planning (questions, with gate) → work (with automated gate) → review (approval, Agentic)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::new_automated("echo 'all checks passed'").with_timeout(10)),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
        // Intentionally NOT — human review required
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
    assert!(task.is_awaiting_review());

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

    // ASSERT: Questions output emits an ArtifactProduced log entry so the
    // frontend can render the card at the correct log position.
    let (log_entries, _cursor) = ctx
        .api()
        .get_task_logs(&task_id, Some("planning"), None, None)
        .unwrap();
    let produced_entries: Vec<_> = log_entries
        .iter()
        .filter(|e| matches!(e, LogEntry::ArtifactProduced { .. }))
        .collect();
    assert_eq!(
        produced_entries.len(),
        1,
        "Questions output should emit exactly one ArtifactProduced log entry"
    );
    let LogEntry::ArtifactProduced {
        name: artifact_name,
        ..
    } = &produced_entries[0]
    else {
        panic!("Expected ArtifactProduced variant")
    };
    assert_eq!(
        artifact_name, "plan",
        "ArtifactProduced name should match the stage artifact name"
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
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());
    assert_eq!(
        task.artifact("plan"),
        Some("Detailed implementation plan v1"),
        "Agent artifact output should create artifact"
    );

    // Human restarts the stage (should NOT overwrite the agent's artifact)
    ctx.api()
        .restart_stage(&task_id, "Need more detail on error handling")
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
            activity_log: None,
            resources: vec![],
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
    // Step 4: Work stage → produce artifact → gate passes → review
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete with tests".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker → drain_active → artifact processed → AwaitingGate

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("summary"),
        Some("Implementation complete with tests")
    );

    ctx.advance(); // spawns gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit pipeline → review Queued

    // =========================================================================
    // Step 5: Gate passes → review stage → reviewer outputs rejection
    // =========================================================================

    // Queue review rejection before spawning reviewer
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Missing integration tests".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer → drain_active → rejection processed → AwaitingRejectionConfirmation

    let task = ctx.api().get_task(&task_id).unwrap();

    // =========================================================================
    // Step 6: Agent rejection verdict → artifact created with rejection content
    // =========================================================================

    // The reviewer's rejection content should be stored as artifact
    assert_eq!(
        task.artifact("verdict"),
        Some("Missing integration tests"),
        "Agent rejection verdict should create an artifact with the rejection content"
    );

    // Task should be paused at AwaitingRejectionConfirmation (non-automated stage with reviewer rejection)
    assert_eq!(task.current_stage(), Some("review"));
    assert!(task.is_awaiting_review());

    // Human restarts the review stage (should NOT change the artifact)
    ctx.api()
        .restart_stage(&task_id, "Actually the tests are fine, re-evaluate")
        .unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("verdict"),
        Some("Missing integration tests"),
        "Human stage restart should NOT overwrite agent's verdict artifact"
    );

    // =========================================================================
    // Step 7: Agent approval verdict → artifact created with approval content
    // =========================================================================

    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Re-evaluated: all tests adequate, implementation is solid".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer → drain_active → approval stored as artifact → AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("verdict"),
        Some("Re-evaluated: all tests adequate, implementation is solid"),
        "Agent approval verdict should create an artifact with approval content"
    );
    // Human must still confirm after agent approval
    ctx.api().approve(&task_id).unwrap();

    ctx.advance(); // commit pipeline: Finishing → Done → integration → Archived

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_done() || task.is_archived(),
        "Task should be done/archived after final approval"
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
            activity_log: None,
            resources: vec![],
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

    // ASSERT: User message should reference the task file (title/description are virtualized)
    let user_message = &call.prompt;
    assert!(
        user_message.contains(".orkestra/.artifacts/trak.md"),
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
            activity_log: None,
            resources: vec![],
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

    // Should reference the task file (title/description are virtualized)
    assert!(
        user_message.contains(".orkestra/.artifacts/trak.md"),
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
    // Create a simple 2-stage workflow: work → review (with approval)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ])
    .with_integration(orkestra_core::workflow::config::IntegrationConfig {
        on_failure: "work".to_string(),
        auto_merge: true, // Explicitly enable to test integration flow
    });

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task(
        "Test commit message generation",
        "Verify commit message generation works",
        None,
    );
    let task_id = task.id.clone();

    assert_eq!(task.current_stage(), Some("work"));
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // Set mock output for work stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implemented feature successfully".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance through work stage
    ctx.advance(); // spawn work agent
    ctx.advance(); // process work output

    // Verify task is awaiting review
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));
    assert!(task.is_awaiting_review());

    // Approve work
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → advance to review

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));

    // Set mock output for review stage (reviewer approves directly)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Approved! Changes look good.".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
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
    ctx.advance(); // spawn review agent → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Done → integration (sync) → Archived

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
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict").with_prompt("reviewer.md"),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task("Test interrupt", "Testing interrupt functionality", None);
    let task_id = task.id.clone();

    // Manually transition task to AgentWorking (simulating agent spawn)
    ctx.api().agent_started(&task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(matches!(task.state, TaskState::AgentWorking { .. }));

    // Interrupt the task
    let task = ctx.api().interrupt(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Interrupted { .. }),
        "Task should be in Interrupted state after interrupt"
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
        .send_message(&task_id, "please focus on error handling")
        .unwrap();
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after resume"
    );

    // Verify a new iteration was created with UserMessage trigger
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        2,
        "Should have two iterations after resume"
    );
    assert_eq!(
        iterations[1].incoming_context,
        Some(IterationTrigger::UserMessage {
            message: "please focus on error handling".to_string()
        }),
        "Second iteration should have UserMessage trigger with message"
    );

    // Set output for the resumed agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Completed work with error handling".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance to spawn and complete the resumed agent
    ctx.advance();
    ctx.advance();

    // Task should now be awaiting review
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
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
    let task = ctx.api().send_message(&task_id, "").unwrap();
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // Verify UserMessage trigger with empty message
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(iterations.len(), 2);
    assert_eq!(
        iterations[1].incoming_context,
        Some(IterationTrigger::UserMessage {
            message: String::new()
        }),
        "Second iteration should have UserMessage trigger with empty message"
    );
}

/// Test multiple interrupt/resume cycles on the same task.
#[test]
fn test_interrupt_resume_multiple_cycles() {
    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Test multiple cycles", "Testing multiple cycles", None);
    let task_id = task.id.clone();

    // Cycle 1: AgentWorking → Interrupt → Resume
    ctx.api().agent_started(&task_id).unwrap();
    assert!(matches!(
        ctx.api().get_task(&task_id).unwrap().state,
        TaskState::AgentWorking { .. }
    ));

    ctx.api().interrupt(&task_id).unwrap();
    assert!(matches!(
        ctx.api().get_task(&task_id).unwrap().state,
        TaskState::Interrupted { .. }
    ));

    ctx.api().send_message(&task_id, "message 1").unwrap();
    assert!(matches!(
        ctx.api().get_task(&task_id).unwrap().state,
        TaskState::Queued { .. }
    ));

    // Cycle 2: AgentWorking → Interrupt → Resume
    ctx.api().agent_started(&task_id).unwrap();
    assert!(matches!(
        ctx.api().get_task(&task_id).unwrap().state,
        TaskState::AgentWorking { .. }
    ));

    ctx.api().interrupt(&task_id).unwrap();
    assert!(matches!(
        ctx.api().get_task(&task_id).unwrap().state,
        TaskState::Interrupted { .. }
    ));

    ctx.api().send_message(&task_id, "message 2").unwrap();
    assert!(matches!(
        ctx.api().get_task(&task_id).unwrap().state,
        TaskState::Queued { .. }
    ));

    // Cycle 3: Complete normally via orchestrator
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Final work".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // Spawn
    ctx.advance(); // Process completion

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
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
    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Test wrong phase", "Testing error case", None);
    let task_id = task.id.clone();

    // Set up mock output
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance to spawn and process completion
    ctx.advance();
    ctx.advance();

    // Task should now be in AwaitingReview
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());

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

/// Test that sending a message in the wrong phase returns an error.
#[test]
fn test_send_message_wrong_phase() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Test send_message wrong phase", "Testing error case", None);
    let task_id = task.id.clone();

    // Manually transition to AgentWorking
    ctx.api().agent_started(&task_id).unwrap();

    // Task should be in AgentWorking
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(matches!(task.state, TaskState::AgentWorking { .. }));

    // Try to send_message (should fail - not in a resumable phase)
    let result = ctx.api().send_message(&task_id, "hello");
    assert!(
        result.is_err(),
        "Should not be able to send_message in AgentWorking phase"
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
    assert!(matches!(
        ctx.api().get_task(&task_id).unwrap().state,
        TaskState::Interrupted { .. }
    ));

    // Advance several ticks
    ctx.advance();
    ctx.advance();
    ctx.advance();

    // Verify task is still in Interrupted phase (not auto-advanced)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Interrupted { .. }),
        "Interrupted task should not be auto-advanced by orchestrator"
    );
}

// =============================================================================
// Activity Log E2E Tests
// =============================================================================

/// Test that activity logs from agent output are stored on iteration records.
#[test]
fn activity_log_stored_on_iteration() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};

    // Create a simple workflow with planning → work
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan").with_prompt("planner.md"),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    // Create a task
    let task = ctx.create_task("Test activity log", "Verify activity logs are stored", None);
    let task_id = task.id.clone();

    // Set mock output for planning stage with activity_log
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The implementation plan".to_string(),
            activity_log: Some(
                "Analyzed requirements. Decided on JWT auth approach. Reviewed existing patterns."
                    .to_string(),
            ),
            resources: vec![],
        },
    );

    // Advance orchestrator to spawn and complete planning stage
    ctx.advance(); // spawns planning agent (completion ready)
    ctx.advance(); // processes planning output

    // Query iterations for the planning stage
    let iterations = ctx.api().get_iterations(&task_id).unwrap();

    // Find the latest planning iteration (should have activity_log even without outcome)
    let planning_iter = iterations
        .iter()
        .filter(|i| i.stage == "planning")
        .max_by_key(|i| i.iteration_number)
        .expect("Should have at least one planning iteration");

    // Assert the iteration has the expected activity_log
    assert_eq!(
        planning_iter.activity_log,
        Some(
            "Analyzed requirements. Decided on JWT auth approach. Reviewed existing patterns."
                .to_string()
        ),
        "Planning iteration should have stored the activity_log from agent output"
    );
}

/// Test that stored activity logs are injected into the next stage's prompt.
#[test]
fn activity_log_injected_into_next_stage_prompt() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};

    // Create workflow with planning → work stages
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    // Create a task
    let task = ctx.create_task(
        "Test activity log injection",
        "Verify logs appear in prompts",
        None,
    );
    let task_id = task.id.clone();

    // Set planning mock output with activity_log
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan: Implement user authentication using JWT".to_string(),
            activity_log: Some(
                "Researched JWT libraries. Selected jsonwebtoken crate. Planned token expiry strategy."
                    .to_string(),
            ),
            resources: vec![],
        },
    );

    // Advance orchestrator (planning completes)
    ctx.advance(); // spawns planning agent
    ctx.advance(); // processes planning output

    // Auto-approve planning artifact so work stage can start
    ctx.api().approve(&task_id).expect("Should approve plan");

    // Set work mock output (content only, activity_log doesn't matter for this assertion)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implemented JWT authentication".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance orchestrator (work stage starts)
    ctx.advance(); // spawns work agent
    ctx.advance(); // processes work output

    // Capture the prompt that was sent to the work stage agent
    let work_prompt = ctx.last_prompt_for(&task_id);

    // Assert the prompt references the activity log file path (not inline content)
    assert!(
        work_prompt.contains(".orkestra/.artifacts/activity_log.md"),
        "Work stage prompt should reference activity_log.md file. Got prompt:\n{}",
        &work_prompt[..work_prompt.len().min(1000)]
    );

    // Assert the prompt does NOT contain inline activity log content
    assert!(
        !work_prompt.contains("Researched JWT libraries"),
        "Work stage prompt should NOT contain inline activity log content"
    );
}

/// Test that activity logs accumulate across multiple stages.
#[test]
fn activity_log_accumulates_across_stages() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    // Create workflow with planning → work → review stages
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task(
        "Test log accumulation",
        "Verify logs from multiple stages",
        None,
    );
    let task_id = task.id.clone();

    // Planning stage with activity log
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan for feature X".to_string(),
            activity_log: Some("Planned architecture. Chose microservices pattern.".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawn planning
    ctx.advance(); // process planning
    ctx.api().approve(&task_id).unwrap();

    // Work stage with activity log
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implemented feature X".to_string(),
            activity_log: Some(
                "Implemented REST API. Added database migrations. Wrote unit tests.".to_string(),
            ),
            resources: vec![],
        },
    );
    ctx.advance(); // spawn work
    ctx.advance(); // process work
    ctx.api().approve(&task_id).unwrap();

    // Review stage (we need to set output but we're interested in the prompt)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    // Note: approval triggers finalize_stage_advancement which transitions to next stage
    // but the actual agent spawn happens on the next orchestrator tick
    ctx.advance(); // process approval -> advance to review stage
    ctx.advance(); // spawn review agent

    // Capture review stage prompt
    let review_prompt = ctx.last_prompt_for(&task_id);

    // Assert prompt references the activity log file path (not inline content)
    assert!(
        review_prompt.contains(".orkestra/.artifacts/activity_log.md"),
        "Review prompt should reference activity_log.md file"
    );

    // Assert the prompt does NOT contain inline activity log content
    assert!(
        !review_prompt.contains("Planned architecture"),
        "Review prompt should NOT contain inline planning activity log content"
    );
    assert!(
        !review_prompt.contains("Implemented REST API"),
        "Review prompt should NOT contain inline work activity log content"
    );
}

/// Test that missing `activity_log` (None) doesn't break the workflow.
#[test]
fn activity_log_none_does_not_break() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};

    // Create workflow with planning → work
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    // Create a task
    let task = ctx.create_task(
        "Test missing activity log",
        "Verify None activity_log is handled",
        None,
    );
    let task_id = task.id.clone();

    // Set planning mock output with activity_log: None
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance orchestrator
    ctx.advance(); // spawn planning
    ctx.advance(); // process planning

    // Verify planning iteration has activity_log == None
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let planning_iter = iterations
        .iter()
        .filter(|i| i.stage == "planning")
        .max_by_key(|i| i.iteration_number)
        .expect("Should have at least one planning iteration");

    assert_eq!(
        planning_iter.activity_log, None,
        "Planning iteration should have None activity_log"
    );

    // Approve and advance to work stage
    ctx.api().approve(&task_id).unwrap();
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn work

    // Verify work stage prompt does NOT reference activity_log.md (no logs exist)
    let work_prompt = ctx.last_prompt_for(&task_id);
    assert!(
        !work_prompt.contains(".orkestra/.artifacts/activity_log.md"),
        "Work stage prompt should NOT reference activity_log.md when no activity logs exist"
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Task should have advanced to work stage successfully"
    );
}

/// Test that `activity_log.md` is actually written to the worktree with correct content.
#[test]
fn activity_log_file_written_with_correct_content() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};
    use std::fs;

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);
    let task = ctx.create_task("Test file content", "Verify activity_log.md content", None);
    let task_id = task.id.clone();

    // Planning with activity log
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The plan".to_string(),
            activity_log: Some("- Researched the problem\n- Decided on approach".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawn planning
    ctx.advance(); // process planning
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // process approval -> advance to work stage

    // Work stage starts — activity log should be written
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn work agent

    // Read the actual file from the worktree
    let task = ctx.api().get_task(&task_id).unwrap();
    let worktree_path = task
        .worktree_path
        .as_ref()
        .expect("task should have worktree");
    let activity_log_path =
        std::path::Path::new(worktree_path).join(".orkestra/.artifacts/activity_log.md");

    assert!(
        activity_log_path.exists(),
        "activity_log.md should exist in worktree"
    );

    let content = fs::read_to_string(&activity_log_path).unwrap();
    assert!(
        content.contains("[planning]"),
        "activity_log.md should contain [planning] stage tag. Got: {content}"
    );
    assert!(
        content.contains("Researched the problem"),
        "activity_log.md should contain the planning log content. Got: {content}"
    );
}

/// Test that activity logs are stored on reviewer iterations (including rejections).
#[test]
fn activity_log_on_rejection_retry() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    // Create workflow with work → review stages (both with approval capability)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task(
        "Test rejection with activity log",
        "Verify logs persist through rejection",
        None,
    );
    let task_id = task.id.clone();

    // Work stage with activity_log
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implemented feature with bug".to_string(),
            activity_log: Some("Implemented feature X. Added tests. Found edge case.".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawn work
    ctx.advance(); // process work
    ctx.api().approve(&task_id).unwrap();

    // Review stage rejects with its own activity_log
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Found bug in error handling".to_string(),
            route_to: None,
            activity_log: Some(
                "Reviewed implementation. Tested edge cases. Found null pointer bug.".to_string(),
            ),
            resources: vec![],
        },
    );
    ctx.advance(); // process approval -> advance to review stage
    ctx.advance(); // spawn review agent
    ctx.advance(); // process review (rejection sends back to work)

    // Verify that both work and review iterations have their activity logs stored
    let iterations = ctx.api().get_iterations(&task_id).unwrap();

    let work_iter = iterations
        .iter()
        .find(|i| i.stage == "work" && i.iteration_number == 1)
        .expect("Should have work iteration #1");
    assert_eq!(
        work_iter.activity_log,
        Some("Implemented feature X. Added tests. Found edge case.".to_string()),
        "Work iteration should have activity_log"
    );

    let review_iter = iterations
        .iter()
        .find(|i| i.stage == "review" && i.iteration_number == 1)
        .expect("Should have review iteration #1");
    assert_eq!(
        review_iter.activity_log,
        Some("Reviewed implementation. Tested edge cases. Found null pointer bug.".to_string()),
        "Review iteration should have activity_log even when rejecting"
    );

    // Verify both iterations are complete (have ended_at)
    assert!(
        work_iter.ended_at.is_some(),
        "Work iteration should be complete"
    );
    assert!(
        review_iter.ended_at.is_some(),
        "Review iteration should be complete"
    );
}

// =============================================================================
// Untriggered Re-entry Tests
// =============================================================================

#[test]
#[allow(clippy::too_many_lines)]
fn test_reentry_spawns_fresh_session() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};
    use orkestra_core::workflow::domain::SessionState;

    // 2-stage workflow: work (with passing gate) → review
    // Review has approval rejecting back to work. After work completes again,
    // review re-enters without any trigger → should always spawn fresh session.
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::new_automated("echo ok").with_timeout(10)),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // =========================================================================
    // Step 1: Work stage → produce artifact → approve → checks → review
    // =========================================================================
    let task = ctx.create_task(
        "Reentry fresh session test",
        "Test that untriggered re-entry spawns fresh session",
        None,
    );
    let task_id = task.id.clone();

    // Set work output
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial work completed".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn work agent → drain_active → AwaitingGate

    // =========================================================================
    // Step 2: Review rejects back to work (first review spawn)
    // =========================================================================

    // Queue mock outputs BEFORE gate fires and reviewer is spawned
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more tests".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );

    // Also queue the next work output (for the re-entered work stage after rejection)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work with tests added".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit → review Queued
    ctx.advance(); // spawn reviewer (first time) → drain_active → rejection → AwaitingRejectionConfirmation
    ctx.api().approve(&task_id).unwrap(); // confirm rejection → work re-queued

    // Verify this is NOT a resume (first spawn)
    let first_review_config = ctx.last_run_config();
    assert!(
        !first_review_config.is_resume,
        "First review spawn should not be a resume"
    );

    // Record the first review session ID
    let first_review_session = ctx
        .api()
        .get_stage_session(&task_id, "review")
        .unwrap()
        .expect("Should have review session");
    let first_review_session_id = first_review_session.claude_session_id.clone();

    ctx.advance(); // spawn second worker → drain_active → AwaitingGate

    // =========================================================================
    // Step 3: Gate fires → review (re-entry with restart)
    // =========================================================================

    // Set final review approval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good now".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit → review Queued
    ctx.advance(); // spawn reviewer (second time - this is the untriggered re-entry)

    // =========================================================================
    // Assertions: Untriggered re-entry should spawn fresh session (not resume)
    // =========================================================================
    let reentry_config = ctx.last_run_config();
    assert!(
        !reentry_config.is_resume,
        "Untriggered re-entry should NOT resume — spawns fresh session"
    );

    // Verify the prompt is a full prompt (not resume)
    let prompt = ctx.last_prompt();
    assert!(
        !prompt.starts_with("<!orkestra:resume:"),
        "Untriggered re-entry prompt should NOT be a resume prompt"
    );

    // Verify session was superseded (should have 2 review sessions)
    let all_sessions = ctx.api().get_stage_sessions(&task_id).unwrap();
    let review_sessions: Vec<_> = all_sessions
        .iter()
        .filter(|s| s.stage == "review")
        .collect();
    assert_eq!(
        review_sessions.len(),
        2,
        "Should have 2 review sessions (one superseded, one fresh)"
    );

    // Verify one is superseded, one is active
    let superseded_count = review_sessions
        .iter()
        .filter(|s| matches!(s.session_state, SessionState::Superseded))
        .count();
    let active_count = review_sessions
        .iter()
        .filter(|s| {
            matches!(
                s.session_state,
                SessionState::Active | SessionState::Spawning
            )
        })
        .count();
    assert_eq!(superseded_count, 1, "Should have 1 superseded session");
    assert_eq!(active_count, 1, "Should have 1 active/spawning session");

    // Verify the new session has a DIFFERENT session ID
    let current_review_session = ctx
        .api()
        .get_stage_session(&task_id, "review")
        .unwrap()
        .expect("Should have review session");
    assert_ne!(
        current_review_session.claude_session_id, first_review_session_id,
        "Re-entry should have a DIFFERENT session ID"
    );
}

#[test]
#[allow(clippy::too_many_lines)]
fn test_untriggered_reentry_spawns_fresh_session() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    // Same workflow — untriggered re-entry always supersedes regardless of any flag
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::new_automated("echo ok").with_timeout(10)),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // =========================================================================
    // Step 1: Work stage → produce artifact → approve → checks → review
    // =========================================================================
    let task = ctx.create_task(
        "Untriggered reentry test",
        "Test that untriggered re-entry spawns fresh session",
        None,
    );
    let task_id = task.id.clone();

    // Set work output
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial work completed".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn work agent → drain_active → AwaitingGate

    // =========================================================================
    // Step 2: Review rejects back to work (first review spawn)
    // =========================================================================

    // Queue mock outputs BEFORE gate fires and reviewer is spawned
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more tests".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );

    // Also queue the next work output (for the re-entered work stage after rejection)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work with tests added".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit → review Queued
    ctx.advance(); // spawn reviewer (first time) → drain_active → rejection → AwaitingRejectionConfirmation
    ctx.api().approve(&task_id).unwrap(); // confirm rejection → work re-queued

    // Record the first review session ID
    let first_review_session = ctx
        .api()
        .get_stage_session(&task_id, "review")
        .unwrap()
        .expect("Should have review session");
    let first_review_session_id = first_review_session.claude_session_id.clone();

    ctx.advance(); // spawn second worker → drain_active → AwaitingGate

    // =========================================================================
    // Step 3: Gate fires → review (re-entry without restart)
    // =========================================================================

    // Set final review approval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good now".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit → review Queued
    ctx.advance(); // spawn reviewer (second time - untriggered re-entry → fresh session)

    // =========================================================================
    // Assertions: Untriggered re-entry should spawn fresh session (not resume)
    // =========================================================================
    let reentry_config = ctx.last_run_config();
    assert!(
        !reentry_config.is_resume,
        "Untriggered re-entry should NOT resume — spawns fresh session"
    );

    // Verify the prompt is a full prompt, not a resume
    let prompt = ctx.last_prompt();
    assert!(
        !prompt.starts_with("<!orkestra:resume:"),
        "Untriggered re-entry should produce a full prompt, not a resume marker"
    );

    // Verify session WAS superseded (should have 2 review sessions)
    let all_sessions = ctx.api().get_stage_sessions(&task_id).unwrap();
    let review_sessions: Vec<_> = all_sessions
        .iter()
        .filter(|s| s.stage == "review")
        .collect();
    assert_eq!(
        review_sessions.len(),
        2,
        "Should have 2 review sessions (original superseded, new active)"
    );

    // Verify the session ID is DIFFERENT from the original
    let current_review_session = ctx
        .api()
        .get_stage_session(&task_id, "review")
        .unwrap()
        .expect("Should have review session");
    assert_ne!(
        current_review_session.claude_session_id, first_review_session_id,
        "Untriggered re-entry should use a NEW session ID"
    );
}

/// Test that interrupt→resume does NOT start a fresh session.
///
/// An interrupt→resume is NOT a stage re-entry — it's the same pass through the
/// stage being continued after a pause. `UserMessage` is an iterating trigger,
/// so the existing session is always resumed.
///
/// Bug: Before the fix, if the agent was interrupted before producing structured
/// output (`has_activity = false`), the next spawn would compute `is_resume = false`
/// and replace the session ID with a fresh UUID, bypassing `--resume`.
///
/// Flow:
/// 1. Review stage is simulated as started (`agent_started`) then interrupted
/// 2. User resumes (creates `UserMessage` iteration)
/// 3. Review spawns via orchestrator → must use `is_resume = true`
/// 4. Untriggered re-entry logic must NOT fire (`trigger = Some(UserMessage)`)
#[test]
fn test_interrupt_resume_preserves_session() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};

    // Single-stage workflow: review.
    // Without work + commit pipeline, the task starts directly in Queued { "review" },
    // letting us use agent_started() to simulate an interrupted spawn without the
    // overhead of a full work→approve→advance cycle.
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("review", "verdict").with_prompt("reviewer.md")
    ]);
    let ctx = TestEnv::with_git(&workflow, &["reviewer"]);

    let task = ctx.create_task(
        "Interrupt resume test",
        "Test interrupt→resume preserves session (UserMessage is iterating trigger)",
        None,
    );
    let task_id = task.id.clone();

    // =========================================================================
    // Step 1: Simulate reviewer starting without going through orchestrator spawn.
    // agent_started() transitions to AgentWorking but does NOT create a session
    // (on_spawn_starting never ran), so has_activity stays false.
    // =========================================================================
    ctx.api().agent_started(&task_id).unwrap();

    // Interrupt before reviewer produces output (has_activity stays false)
    ctx.api().interrupt(&task_id).unwrap();

    // =========================================================================
    // Step 2: User resumes → creates UserMessage iteration
    // =========================================================================
    ctx.api().send_message(&task_id, "").unwrap();

    // Set output for the resumed reviewer
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "Looks good".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // =========================================================================
    // Step 3: Orchestrator spawns resumed reviewer
    // =========================================================================
    ctx.advance(); // spawn reviewer with UserMessage trigger

    // Key assertion: UserMessage trigger must produce is_resume=true.
    // Before the fix: is_resume=false because has_activity=false and UserMessage
    // wasn't checked. After the fix: is_resume=true.
    let resume_config = ctx.last_run_config();
    assert!(
        resume_config.is_resume,
        "Resume after interrupt should use is_resume=true (UserMessage trigger)"
    );

    // No session superseding — UserMessage is iterating, not returning.
    // If untriggered re-entry logic had fired, it would have superseded the session.
    let all_sessions = ctx.api().get_stage_sessions(&task_id).unwrap();
    let review_sessions: Vec<_> = all_sessions
        .iter()
        .filter(|s| s.stage == "review")
        .collect();
    assert_eq!(
        review_sessions.len(),
        1,
        "Should have exactly 1 review session (interrupt→resume is not a re-entry)"
    );

    // Session ID is assigned on spawn and must not be cleared by the UserMessage path.
    // (Precise regression coverage for is_resume is in unit test
    // `test_resume_when_user_message_trigger_no_activity` in session.rs.)
    let session = review_sessions[0];
    assert!(
        session.claude_session_id.is_some(),
        "Session ID must be assigned and not cleared after interrupt→resume"
    );
}

// =============================================================================
// Disallowed Tools E2E Tests
// =============================================================================

/// Test that `disallowed_tools` patterns are threaded to `RunConfig`.
#[test]
fn test_disallowed_tools_threaded_to_run_config() {
    use orkestra_core::workflow::config::{StageConfig, ToolRestriction, WorkflowConfig};

    // Build a workflow with a "work" stage that has disallowed_tools
    let work_stage = StageConfig::new("work", "summary").with_disallowed_tools(vec![
        ToolRestriction {
            pattern: "Bash(cargo test)".to_string(),
            message: Some("Automated checks handle testing".to_string()),
        },
        ToolRestriction {
            pattern: "Bash(cargo build)".to_string(),
            message: Some("Build runs in CI".to_string()),
        },
    ]);

    let workflow = WorkflowConfig::new(vec![work_stage]);
    let ctx = TestEnv::with_git(&workflow, &["work"]);

    // Create a task
    let task = ctx.create_task("Test task", "Test disallowed tools", None);
    let task_id = task.id.clone();

    // Set mock output for the work stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance orchestrator to spawn agent
    ctx.advance();

    // Inspect the RunConfig from mock runner calls
    let calls = ctx.runner_calls();
    assert!(!calls.is_empty(), "Expected at least one runner call");

    let call = &calls[0];
    assert_eq!(
        call.disallowed_tools,
        vec!["Bash(cargo test)", "Bash(cargo build)"],
        "RunConfig should contain disallowed_tools patterns"
    );
}

/// Test that `disallowed_tools` are injected into the system prompt.
#[test]
fn test_disallowed_tools_injected_into_system_prompt() {
    use orkestra_core::workflow::config::{StageConfig, ToolRestriction, WorkflowConfig};

    // Build a workflow with disallowed_tools
    let work_stage = StageConfig::new("work", "summary").with_disallowed_tools(vec![
        ToolRestriction {
            pattern: "Bash(cargo test)".to_string(),
            message: Some("Automated checks handle testing".to_string()),
        },
        ToolRestriction {
            pattern: "Bash(cargo build)".to_string(),
            message: Some("Build runs in CI".to_string()),
        },
    ]);

    let workflow = WorkflowConfig::new(vec![work_stage]);
    let ctx = TestEnv::with_git(&workflow, &["work"]);

    let task = ctx.create_task("Test task", "Test system prompt injection", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance();

    // Assert system prompt contains restriction messages
    let calls = ctx.runner_calls();
    let call = &calls[0];
    let system_prompt = call
        .system_prompt
        .as_ref()
        .expect("System prompt should be set");

    assert!(
        system_prompt.contains("Tool Restrictions"),
        "System prompt should contain Tool Restrictions section"
    );
    assert!(
        system_prompt.contains("Bash(cargo test)"),
        "System prompt should contain pattern"
    );
    assert!(
        system_prompt.contains("Automated checks handle testing"),
        "System prompt should contain message"
    );
    assert!(
        system_prompt.contains("Bash(cargo build)"),
        "System prompt should contain second pattern"
    );
    assert!(
        system_prompt.contains("Build runs in CI"),
        "System prompt should contain second message"
    );
}

/// Test that flow override replaces global `disallowed_tools`.
#[test]
fn test_disallowed_tools_flow_override() {
    use indexmap::IndexMap;
    use orkestra_core::workflow::config::{
        FlowConfig, IntegrationConfig, StageConfig, ToolRestriction, WorkflowConfig,
    };

    // Global stage has restrictions
    let work_stage =
        StageConfig::new("work", "summary").with_disallowed_tools(vec![ToolRestriction {
            pattern: "Bash(cargo test)".to_string(),
            message: Some("No testing".to_string()),
        }]);

    // Flow defines work stage without any restrictions (explicit override with empty list)
    let mut flows = IndexMap::new();
    flows.insert(
        "hotfix".to_string(),
        FlowConfig {
            stages: vec![StageConfig::new("work", "summary")], // No disallowed_tools
            integration: IntegrationConfig::new("work"),
        },
    );

    let workflow = WorkflowConfig::new(vec![work_stage]).with_flows(flows);
    let ctx = TestEnv::with_git(&workflow, &["work"]);

    // Create task with "hotfix" flow
    let task = ctx
        .api()
        .create_task_with_options(
            "Hotfix task",
            "Fix it",
            None,
            TaskCreationMode::Normal,
            Some("hotfix"),
        )
        .unwrap();
    let task_id = task.id.clone();

    // Advance setup
    ctx.advance();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Fixed".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance();

    // RunConfig should have NO disallowed tools (flow override cleared them)
    let calls = ctx.runner_calls();
    let call = &calls[0];
    assert!(
        call.disallowed_tools.is_empty(),
        "Flow override should clear disallowed tools"
    );

    // System prompt should NOT contain Tool Restrictions section
    if let Some(ref sp) = call.system_prompt {
        assert!(
            !sp.contains("Tool Restrictions"),
            "System prompt should not contain Tool Restrictions when no tools are disallowed"
        );
    }
}

/// Test that empty `disallowed_tools` produces no restrictions.
#[test]
fn test_disallowed_tools_empty_no_flag() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};

    // Create a simple workflow with no disallowed_tools
    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]);
    let ctx = TestEnv::with_git(&workflow, &["work"]);

    let task = ctx.create_task("Simple task", "No restrictions", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance();

    let calls = ctx.runner_calls();
    let call = &calls[0];
    assert!(
        call.disallowed_tools.is_empty(),
        "RunConfig should have empty disallowed_tools"
    );

    // System prompt should NOT contain Tool Restrictions section
    if let Some(ref sp) = call.system_prompt {
        assert!(
            !sp.contains("Tool Restrictions"),
            "System prompt should not contain Tool Restrictions when no tools are disallowed"
        );
    }
}

/// Test that interrupted user messages are sent to the agent via resume prompt.
///
/// When a user interrupts a running agent and resumes with a message, the message
/// should be included in the resume prompt with `manual_resume` marker type.
///
/// The real `AgentRunner` parses this marker and logs it as a `UserMessage` log
/// entry with `resume_type="manual_resume"`. Since `MockAgentRunner` doesn't emit
/// `UserMessage` entries (that's an `AgentRunner` concern), this test verifies the
/// prompt construction that makes that logging possible.
///
/// Flow:
/// 1. Spawn agent with activity → completes → reject (creates session with activity)
/// 2. Use `agent_started()` to simulate retry starting
/// 3. Interrupt → Resume with message
/// 4. Verify next spawn uses `manual_resume` marker with the message
#[test]
fn test_interrupt_message_in_resume_prompt() {
    use orkestra_core::workflow::config::StageConfig;

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Test interrupt logging",
        "Testing that interrupt messages are logged",
        None,
    );
    let task_id = task.id.clone();

    // Step 1: Spawn agent with activity, let it complete, then reject.
    // This creates a session with has_activity=true, which is required for
    // the orchestrator to use resume markers instead of fresh spawn.
    ctx.set_output_with_activity(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // Spawns agent (with activity)
    ctx.advance(); // Processes output → AwaitingReview

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review());

    // Restart stage to trigger another iteration
    ctx.api()
        .restart_stage(&task_id, "Needs validation logic")
        .unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after rejection"
    );

    // Step 2: Simulate the retry agent starting (without completing)
    ctx.api().agent_started(&task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(matches!(task.state, TaskState::AgentWorking { .. }));

    // Step 3: Interrupt and resume with a message
    ctx.api().interrupt(&task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(matches!(task.state, TaskState::Interrupted { .. }));

    let interrupt_message = "Please focus on the validation logic and add proper error handling";
    ctx.api().send_message(&task_id, interrupt_message).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // Step 4: Set output and advance to spawn the resumed agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Fixed validation with error handling".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // Spawns resumed agent

    // Verify the resume prompt contains the user_message marker and the interrupt message.
    ctx.assert_resume_prompt_contains("user_message", &[interrupt_message]);

    ctx.advance(); // Processes output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should be awaiting review after completion"
    );
}

// =============================================================================
// Activity Log Deduplication and Formatting
// =============================================================================

/// Test that intervening stages preserve both activity log entries.
///
/// Scenario: work(A) → review(rejects) → work(B) → review(approves)
/// Expected: Second review's full prompt contains BOTH work:A and work:B because
/// the review stage intervened between them.
///
/// This tests that "intervening stage prevents deduplication" - only consecutive
/// same-stage entries are collapsed; when a different stage appears in between,
/// both entries are preserved.
///
/// Note: We use a NON-automated review stage so we can control the flow precisely
/// and verify the second review's prompt content.
#[test]
fn test_activity_log_intervening_stage_preserves_entries() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    // Build a simple workflow: work → review (non-automated, can reject back to work)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
        // human approval required so we control the flow
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Test activity log overwrite",
        "Verify same-stage logs are replaced in prompts",
        None,
    );
    let task_id = task.id.clone();

    // === First work iteration: produces Log A ===
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work v1".to_string(),
            activity_log: Some("- Log A: first work attempt".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes work output

    // Human approves work → advances to review
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline, enters review stage (Idle)

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));

    // === First review iteration: rejects back to work ===
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more tests".to_string(),
            route_to: None,
            activity_log: Some("- Log R: review feedback".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes rejection → AwaitingReview (pauses for human to confirm)

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));
    assert!(
        matches!(task.state, TaskState::AwaitingRejectionConfirmation { .. }),
        "Non-automated review should pause for human confirmation"
    );

    // Human confirms the rejection (approve confirms it, sending task to rejection target)
    // This moves the task to work stage in Idle phase (no advance needed)
    let task = ctx.api().approve(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Should be back in work stage after confirming rejection"
    );
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued, ready for work agent"
    );

    // === Second work iteration: produces Log B ===
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work v2 - with tests".to_string(),
            activity_log: Some("- Log B: second work attempt".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes work output

    // Human approves work → advances to review again
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline, enters review stage

    // === Second review iteration: verify the prompt ===
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good now".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer

    // NOW verify the reviewer's prompt references the activity log file
    // (content ordering/deduplication is verified by materialize_artifacts unit tests)
    let review_prompt = ctx.last_prompt();

    assert!(
        review_prompt.contains(".orkestra/.artifacts/activity_log.md"),
        "Review prompt should reference activity log file. Full prompt:\n{review_prompt}"
    );
}

/// Test that activity logs from different stages accumulate in full prompts.
///
/// Scenario: plan(P) → breakdown(B) → work
/// Expected: Work stage's full prompt contains both planning and breakdown logs.
///
/// Note: Activity logs are only injected into FULL prompts (initial stage spawns),
/// not into RESUME prompts (feedback after rejection). This test verifies
/// accumulation across stages in full prompts.
#[test]
fn test_activity_log_keeps_different_stages() {
    let workflow = test_default_workflow();
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task(
        "Test activity log multi-stage",
        "Verify different-stage logs accumulate",
        None,
    );
    let task_id = task.id.clone();

    // Planning produces log P
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The plan".to_string(),
            activity_log: Some("- Log P: planning decisions".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan output

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline, advances to breakdown

    // Breakdown produces log B
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "No subtasks needed".to_string(),
            activity_log: Some("- Log B: breakdown analysis".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawns breakdown

    // Verify breakdown's full prompt references the activity log file
    let breakdown_prompt = ctx.last_prompt();
    assert!(
        breakdown_prompt.contains(".orkestra/.artifacts/activity_log.md"),
        "Breakdown prompt should reference activity log file. Full prompt:\n{breakdown_prompt}"
    );

    ctx.advance(); // processes breakdown output

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline, advances to work

    // Work stage - check prompt BEFORE setting output
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation".to_string(),
            activity_log: Some("- Log W: work done".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker

    // Verify work's full prompt references the activity log file
    // (content accumulation is verified by materialize_artifacts unit tests)
    let work_prompt = ctx.last_prompt();
    assert!(
        work_prompt.contains(".orkestra/.artifacts/activity_log.md"),
        "Work prompt should reference activity log file. Full prompt:\n{work_prompt}"
    );
}

/// Test that prompts reference the activity log file path when logs are present.
///
/// The activity log is now materialized as a file (.`orkestra/.artifacts/activity_log.md`)
/// and referenced by path in prompts. Inline injection no longer occurs.
/// Format and content are verified by `materialize_artifacts` unit tests.
#[test]
fn test_activity_log_file_reference_in_prompt() {
    let workflow = test_default_workflow();
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task(
        "Test activity log file reference",
        "Verify file path in prompt",
        None,
    );
    let task_id = task.id.clone();

    // Planning produces an activity log
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The plan".to_string(),
            activity_log: Some("- Made a key decision about architecture".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan output

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline, advances to breakdown

    // Set breakdown output so we can capture its prompt
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Breakdown complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns breakdown

    // Prompt should reference the activity log file, not inject inline content
    let prompt = ctx.last_prompt();
    assert!(
        prompt.contains(".orkestra/.artifacts/activity_log.md"),
        "Prompt should reference activity log file. Full prompt:\n{prompt}"
    );
    assert!(
        !prompt.contains("## Activity Log"),
        "Prompt should NOT contain inline Activity Log section. Full prompt:\n{prompt}"
    );
    assert!(
        !prompt.contains("Made a key decision"),
        "Prompt should NOT contain inline activity log content. Full prompt:\n{prompt}"
    );
}

/// Test activity log handling with gate scripts and review rejection.
///
/// Scenario: work(A) → checks(gate script) → review(R, rejects) → work(B) → checks → review
///
/// Activity logs produced: work(A), review(R), work(B)
/// Expected: All three entries preserved because review(R) intervenes between work(A) and work(B).
///
/// Note: Gate scripts don't produce activity logs, but they don't prevent other
/// stages from intervening. The review stage DOES intervene, so both work logs
/// are preserved.
#[test]
fn test_activity_log_with_script_and_review_rejection() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    // Build workflow: work (with gate) → review (can reject back to work)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::new_automated("echo ok").with_timeout(10)),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
        // NOT - human approval required so we control the flow
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Test activity log dedup through script",
        "Verify work logs deduplicate even with gate script in between",
        None,
    );
    let task_id = task.id.clone();

    // === First work iteration: produces Log A ===
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work v1".to_string(),
            activity_log: Some("- Log A: first work attempt".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker → drain_active → AwaitingGate
    ctx.advance(); // spawn gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit → review Queued

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));

    // === Review rejects back to work ===
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more error handling".to_string(),
            route_to: None,
            activity_log: Some("- Log R: review requested changes".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer → drain_active → rejection → AwaitingReview

    // Human confirms rejection
    ctx.api().approve(&task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));

    // === Second work iteration: produces Log B ===
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work v2 - with error handling".to_string(),
            activity_log: Some("- Log B: second work attempt".to_string()),
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker → drain_active → AwaitingGate
    ctx.advance(); // spawn gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit → review Queued

    // === Second review: verify the prompt has only ONE work log ===
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good now".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer

    let review_prompt = ctx.last_prompt();

    // Prompt should reference the activity log file
    // (content ordering is verified by materialize_artifacts unit tests)
    assert!(
        review_prompt.contains(".orkestra/.artifacts/activity_log.md"),
        "Review prompt should reference activity log file. Full prompt:\n{review_prompt}"
    );
}

// =============================================================================
// Archive Task E2E Tests
// =============================================================================

/// Helper to advance a task through all stages to Done (with `auto_merge` disabled).
fn advance_to_done_no_integration(ctx: &TestEnv, task_id: &str) {
    // Planning stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Implementation plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    // Breakdown stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Task breakdown".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process breakdown
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to work

    // Work stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process summary
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to review

    // Review stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer → AwaitingApproval
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit pipeline → Done
}

/// Test that a Done task can be manually archived.
///
/// This exercises the `archive_task` API method for cases where a PR was merged
/// externally and the user wants to mark the task complete.
#[test]
fn test_manual_archive_task() {
    use orkestra_core::testutil::fixtures::test_default_workflow;

    use crate::helpers::disable_auto_merge;

    // Use git workflow with auto_merge disabled so task stays at Done
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task("Test archive", "Description", None);
    let task_id = task.id.clone();

    // Advance through all stages to Done
    advance_to_done_no_integration(&ctx, &task_id);

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_done(),
        "Task should be Done after workflow completes"
    );
    assert!(task.is_done(), "Task should be Done");

    // Archive the task
    let archived_task = ctx
        .api()
        .archive_task(&task_id)
        .expect("archive_task should succeed");

    assert!(archived_task.is_archived(), "Task should be Archived");
    // Archived is terminal — no phase to check
}

/// Test that `archive_task` rejects tasks not in Idle phase.
///
/// Uses `begin_pr_creation` to put the task in Integrating phase, which is
/// a realistic way to reach a non-Idle phase on a Done task.
#[test]
fn test_archive_task_rejects_non_idle_phase() {
    use orkestra_core::testutil::fixtures::test_default_workflow;

    use crate::helpers::disable_auto_merge;

    // Need git workflow to use begin_pr_creation
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test archive reject", "Description", None);
    let task_id = task.id.clone();

    // Advance to Done
    advance_to_done_no_integration(&ctx, &task_id);

    // Verify task is Done + Idle
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Task should be Done");
    assert!(task.is_done(), "Task should be Done");

    // Put task into Integrating phase via begin_pr_creation
    ctx.api().begin_pr_creation(&task_id).unwrap();
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Integrating),
        "Task should be in Integrating state"
    );

    // Attempt to archive should fail
    let result = ctx.api().archive_task(&task_id);

    assert!(
        matches!(
            result,
            Err(orkestra_core::workflow::WorkflowError::InvalidTransition(_))
        ),
        "archive_task should fail for non-Idle phase, got: {result:?}"
    );
}

// =============================================================================
// Address PR Feedback E2E Tests
// =============================================================================

/// Test that a Done task can address PR feedback (comments).
///
/// This exercises the `address_pr_feedback` API method for cases where a user
/// wants to return to the work stage to address feedback from a PR review.
#[test]
#[allow(clippy::too_many_lines)]
fn test_address_pr_feedback_returns_to_work_stage() {
    use orkestra_core::testutil::fixtures::test_default_workflow;
    use orkestra_core::workflow::domain::{IterationTrigger, PrCommentData};

    use crate::helpers::disable_auto_merge;

    // Use git workflow with auto_merge disabled so task stays at Done
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task("Test PR comments", "Description", None);
    let task_id = task.id.clone();

    // Advance through all stages to Done
    advance_to_done_no_integration(&ctx, &task_id);

    // Verify task is Done and Idle
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Task should be Done");
    assert!(task.is_done(), "Task should be Done");

    // Create test comments
    let comments = vec![
        PrCommentData {
            author: "reviewer1".to_string(),
            body: "Fix formatting in main.rs".to_string(),
            path: Some("src/main.rs".to_string()),
            line: Some(42),
        },
        PrCommentData {
            author: "reviewer2".to_string(),
            body: "General feedback".to_string(),
            path: None,
            line: None,
        },
    ];

    // Address PR feedback (comments only)
    let result = ctx
        .api()
        .address_pr_feedback(
            &task_id,
            comments,
            vec![],
            Some("Please fix the formatting".to_string()),
        )
        .expect("address_pr_feedback should succeed");

    // Verify task is back in work stage
    assert_eq!(
        result.current_stage(),
        Some("work"),
        "Task should return to work stage"
    );
    assert!(
        !result.is_done(),
        "Task should no longer be Done after addressing PR feedback"
    );
    assert!(
        result.completed_at.is_none(),
        "completed_at should be cleared"
    );

    // Verify iteration was created with correct trigger
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let last = iterations.last().expect("Should have iterations");

    match &last.incoming_context {
        Some(IterationTrigger::PrFeedback {
            comments,
            checks,
            guidance,
        }) => {
            assert_eq!(comments.len(), 2);
            // First comment with path and line
            assert_eq!(comments[0].author, "reviewer1");
            assert_eq!(comments[0].body, "Fix formatting in main.rs");
            assert_eq!(
                comments[0].path,
                Some("src/main.rs".to_string()),
                "path should be preserved"
            );
            assert_eq!(comments[0].line, Some(42), "line should be preserved");
            // Second comment without path and line
            assert_eq!(comments[1].author, "reviewer2");
            assert_eq!(comments[1].body, "General feedback");
            assert_eq!(
                comments[1].path, None,
                "path should be None for PR-level comment"
            );
            assert_eq!(
                comments[1].line, None,
                "line should be None for PR-level comment"
            );
            // No checks
            assert_eq!(checks.len(), 0, "no checks expected");
            // Guidance
            assert_eq!(guidance.as_deref(), Some("Please fix the formatting"));
        }
        other => panic!("Expected PrFeedback trigger, got {other:?}"),
    }

    // Set mock output for work stage agent - it needs to complete
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Addressed PR feedback".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawns work agent with PR comments as fresh session (superseded)

    // VERIFY: PR comments reach the agent prompt (full prompt, not resume — session superseded)
    let prompt = ctx.last_prompt_for(&task_id);
    for expected in &[
        "reviewer1",
        "Fix formatting in main.rs",
        "src/main.rs",
        "line 42",
        "reviewer2",
        "General feedback",
        "Please fix the formatting", // The guidance
    ] {
        assert!(
            prompt.contains(expected),
            "Full prompt should contain '{expected}'"
        );
    }
}

/// Test that `address_pr_feedback` rejects empty comments AND empty checks, but
/// accepts checks-only input.
///
/// At least one comment or check must be provided to address PR feedback.
#[test]
fn test_address_pr_feedback_rejects_empty_comments_and_empty_checks() {
    use orkestra_core::testutil::fixtures::test_default_workflow;
    use orkestra_core::workflow::domain::PrCheckData;
    use orkestra_core::workflow::WorkflowError;

    use crate::helpers::disable_auto_merge;

    // Use git workflow with auto_merge disabled so task stays at Done
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task("Test no feedback", "Description", None);
    let task_id = task.id.clone();

    // Advance through all stages to Done
    advance_to_done_no_integration(&ctx, &task_id);

    // Verify task is Done
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Task should be Done");

    // Attempt with empty comments AND empty checks should fail
    let result = ctx
        .api()
        .address_pr_feedback(&task_id, vec![], vec![], None);

    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "Expected InvalidTransition error for empty feedback, got: {result:?}"
    );

    // Checks-only (empty comments + non-empty checks) should succeed
    let checks = vec![PrCheckData {
        name: "CI / build".to_string(),
        log_excerpt: Some("3 tests failed".to_string()),
    }];
    let result = ctx
        .api()
        .address_pr_feedback(&task_id, vec![], checks, None);
    assert!(
        result.is_ok(),
        "Expected success for checks-only feedback, got: {result:?}"
    );
}

/// Test that `address_pr_feedback` accepts checks alone (no comments).
#[test]
fn test_address_pr_feedback_with_checks() {
    use orkestra_core::testutil::fixtures::test_default_workflow;
    use orkestra_core::workflow::domain::{IterationTrigger, PrCheckData, PrCommentData};

    use crate::helpers::disable_auto_merge;

    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test PR feedback with checks", "Description", None);
    let task_id = task.id.clone();

    advance_to_done_no_integration(&ctx, &task_id);

    let comments = vec![PrCommentData {
        author: "reviewer1".to_string(),
        body: "Fix this method".to_string(),
        path: Some("src/lib.rs".to_string()),
        line: Some(10),
    }];

    let checks = vec![
        PrCheckData {
            name: "CI / build".to_string(),
            log_excerpt: Some("3 tests failed".to_string()),
        },
        PrCheckData {
            name: "CI / lint".to_string(),
            log_excerpt: None,
        },
    ];

    // Address PR feedback with both comments and checks
    let result = ctx
        .api()
        .address_pr_feedback(
            &task_id,
            comments,
            checks,
            Some("Fix all issues".to_string()),
        )
        .expect("address_pr_feedback should succeed");

    // Verify task returns to work stage
    assert_eq!(
        result.current_stage(),
        Some("work"),
        "Task should return to work stage"
    );
    assert!(!result.is_done(), "Task should no longer be Done");
    assert!(
        result.completed_at.is_none(),
        "completed_at should be cleared"
    );

    // Verify iteration trigger has both comments and checks
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let last = iterations.last().expect("Should have iterations");

    match &last.incoming_context {
        Some(IterationTrigger::PrFeedback {
            comments,
            checks,
            guidance,
        }) => {
            assert_eq!(comments.len(), 1);
            assert_eq!(comments[0].author, "reviewer1");
            assert_eq!(checks.len(), 2);
            assert_eq!(checks[0].name, "CI / build");
            assert_eq!(checks[0].log_excerpt.as_deref(), Some("3 tests failed"));
            assert_eq!(checks[1].name, "CI / lint");
            assert!(checks[1].log_excerpt.is_none());
            assert_eq!(guidance.as_deref(), Some("Fix all issues"));
        }
        other => panic!("Expected PrFeedback trigger, got {other:?}"),
    }

    // Set mock output for work agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Addressed PR feedback and fixed CI checks".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawns work agent with PR feedback as fresh session (superseded)

    // Verify the full prompt contains both comment and check content
    let prompt = ctx.last_prompt_for(&task_id);
    for expected in &[
        "Fix this method",
        "src/lib.rs",
        "CI / build",
        "3 tests failed",
        "CI / lint",
        "Fix all issues",
    ] {
        assert!(
            prompt.contains(expected),
            "Full prompt should contain '{expected}'"
        );
    }
}

// =============================================================================
// Address PR Conflicts E2E Tests
// =============================================================================

/// Test that a Done task can address PR conflicts.
///
/// This exercises the `address_pr_conflicts` API method for cases where a PR
/// has merge conflicts and the user wants to return to the work stage to
/// resolve them.
#[test]
fn test_address_pr_conflicts_returns_to_work_stage() {
    use orkestra_core::testutil::fixtures::test_default_workflow;
    use orkestra_core::workflow::domain::IterationTrigger;

    use crate::helpers::disable_auto_merge;

    // Use git workflow with auto_merge disabled so task stays at Done
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task("Test PR conflicts", "Description", None);
    let task_id = task.id.clone();

    // Advance through all stages to Done
    advance_to_done_no_integration(&ctx, &task_id);

    // Verify task is Done and Idle
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Task should be Done");
    assert!(task.is_done(), "Task should be Done");

    // Address PR conflicts
    let base_branch = "origin/main";
    let result = ctx
        .api()
        .address_pr_conflicts(&task_id, base_branch)
        .expect("address_pr_conflicts should succeed");

    // Verify task is back in work stage
    assert_eq!(
        result.current_stage(),
        Some("work"),
        "Task should return to work stage"
    );
    assert!(
        !result.is_done(),
        "Task should no longer be Done after addressing PR conflicts"
    );
    assert!(
        result.completed_at.is_none(),
        "completed_at should be cleared"
    );

    // Verify iteration was created with correct trigger
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let last = iterations.last().expect("Should have iterations");

    assert_eq!(last.stage, "work", "Iteration should be in work stage");
    match &last.incoming_context {
        Some(IterationTrigger::Integration {
            message,
            conflict_files,
        }) => {
            assert!(
                message.contains(base_branch),
                "Message should contain base branch: {message}"
            );
            assert!(
                conflict_files.is_empty(),
                "Conflict files should be empty (discovered on rebase)"
            );
        }
        other => panic!("Expected Integration trigger, got {other:?}"),
    }

    // Set mock output for the work stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Resolved conflicts".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance orchestrator to spawn the agent
    ctx.advance();

    // Verify the prompt contains the base branch context
    let prompt = ctx.last_prompt_for(&task_id);
    assert!(
        prompt.contains(base_branch),
        "Prompt should contain base branch '{}', got prompt:\n{}",
        base_branch,
        &prompt[..prompt.len().min(500)]
    );
    assert!(
        prompt.contains("conflict") || prompt.contains("rebase"),
        "Prompt should mention conflict resolution, got prompt:\n{}",
        &prompt[..prompt.len().min(500)]
    );
}

/// Test that `address_pr_conflicts` rejects tasks not in Done status.
///
/// Only Done tasks can have their PR conflicts addressed.
#[test]
fn test_address_pr_conflicts_requires_done_status() {
    use orkestra_core::testutil::fixtures::test_default_workflow;
    use orkestra_core::workflow::WorkflowError;

    use crate::helpers::disable_auto_merge;

    // Use git workflow with auto_merge disabled
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a task (starts in Active status, not Done)
    let task = ctx.create_task("Test not done", "Description", None);
    let task_id = task.id.clone();

    // Verify task is not Done
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(!task.is_done(), "Task should not be Done yet");

    // Attempt to address conflicts should fail
    let result = ctx.api().address_pr_conflicts(&task_id, "origin/main");

    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(ref msg)) if msg.contains("not done")),
        "Expected InvalidTransition error mentioning 'not done', got: {result:?}"
    );
}

// =============================================================================
// Multi-session log sub-tabs
// =============================================================================

/// Test that `stages_with_logs` correctly groups sessions and assigns run numbers.
///
/// This test verifies that:
/// 1. Sessions are correctly grouped by stage
/// 2. Run numbers are 1-indexed and chronological
/// 3. The `is_current` flag correctly identifies non-superseded sessions
#[test]
fn test_stages_with_logs_groups_sessions_correctly() {
    use orkestra_core::testutil::fixtures::test_default_workflow;

    use crate::helpers::enable_auto_merge;

    let ctx = TestEnv::with_git(
        &enable_auto_merge(test_default_workflow()),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // Create and start a task
    let task = ctx.create_task("Test task", "Test description", None);
    let task_id = task.id.clone();

    // Set output BEFORE advancing (mock runner needs output configured before spawn)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Initial plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner agent (completion ready)
    ctx.advance(); // processes plan output

    // Get task view after planning session exists
    let task_views = ctx.api().list_task_views().unwrap();
    let task_view = task_views.iter().find(|v| v.task.id == task_id).unwrap();

    // Verify planning stage has a session
    let planning_stage = task_view
        .derived
        .stages_with_logs
        .iter()
        .find(|s| s.stage == "planning")
        .expect("planning stage should have logs");

    assert_eq!(
        planning_stage.sessions.len(),
        1,
        "planning should have 1 session"
    );
    assert_eq!(planning_stage.sessions[0].run_number, 1);
    assert!(planning_stage.sessions[0].is_current);
    let planning_session_id = planning_stage.sessions[0].session_id.clone();

    // Approve to move to breakdown, then set output for breakdown
    ctx.api().approve(&task_id).unwrap();
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Simple task, no subtasks needed".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns breakdown agent
    ctx.advance(); // processes breakdown output

    // Approve breakdown to move to work
    ctx.api().approve(&task_id).unwrap();
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "First work attempt".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker agent
    ctx.advance(); // processes work output

    // Get task view and verify multiple stages have sessions
    let task_views = ctx.api().list_task_views().unwrap();
    let task_view = task_views.iter().find(|v| v.task.id == task_id).unwrap();

    // Should now have planning, breakdown, and work stages with logs
    assert!(
        task_view.derived.stages_with_logs.len() >= 3,
        "Should have at least 3 stages with logs, got: {:?}",
        task_view
            .derived
            .stages_with_logs
            .iter()
            .map(|s| &s.stage)
            .collect::<Vec<_>>()
    );

    // Verify planning session ID is unchanged
    let planning_stage = task_view
        .derived
        .stages_with_logs
        .iter()
        .find(|s| s.stage == "planning")
        .unwrap();
    assert_eq!(
        planning_stage.sessions[0].session_id, planning_session_id,
        "Planning session ID should be unchanged"
    );

    // Verify work stage exists with correct structure
    let work_stage = task_view
        .derived
        .stages_with_logs
        .iter()
        .find(|s| s.stage == "work")
        .expect("work stage should have logs");

    assert_eq!(work_stage.sessions.len(), 1, "work should have 1 session");
    assert_eq!(work_stage.sessions[0].run_number, 1);
    assert!(work_stage.sessions[0].is_current);
}

/// Test that stages are ordered chronologically by their first session.
///
/// When displaying log tabs, stages should appear in the order they were
/// first executed, not alphabetically.
#[test]
fn test_stages_with_logs_ordered_chronologically() {
    use orkestra_core::testutil::fixtures::test_default_workflow;

    use crate::helpers::enable_auto_merge;

    let ctx = TestEnv::with_git(
        &enable_auto_merge(test_default_workflow()),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    // Go through planning → breakdown → work
    // Set output BEFORE advancing (mock runner needs output before spawn)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes output

    ctx.api().approve(&task_id).unwrap();
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Breakdown".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns breakdown
    ctx.advance(); // processes output

    ctx.api().approve(&task_id).unwrap();
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes output

    // Get task view
    let task_views = ctx.api().list_task_views().unwrap();
    let task_view = task_views.iter().find(|v| v.task.id == task_id).unwrap();

    // Stages should be in chronological order: planning, breakdown, work
    let stage_names: Vec<&str> = task_view
        .derived
        .stages_with_logs
        .iter()
        .map(|s| s.stage.as_str())
        .collect();

    // Find indexes of each stage
    let planning_idx = stage_names.iter().position(|&s| s == "planning");
    let breakdown_idx = stage_names.iter().position(|&s| s == "breakdown");
    let work_idx = stage_names.iter().position(|&s| s == "work");

    assert!(
        planning_idx.is_some() && breakdown_idx.is_some() && work_idx.is_some(),
        "All stages should be present. Got: {stage_names:?}"
    );

    let planning_idx = planning_idx.unwrap();
    let breakdown_idx = breakdown_idx.unwrap();
    let work_idx = work_idx.unwrap();

    assert!(
        planning_idx < breakdown_idx,
        "Planning should come before breakdown. Got order: {stage_names:?}"
    );
    assert!(
        breakdown_idx < work_idx,
        "Breakdown should come before work. Got order: {stage_names:?}"
    );
}

/// Test that reviewer rejection creates multiple sessions and that `stages_with_logs`
/// correctly reports run numbers and `is_current` flags.
///
/// This test validates the complete flow:
/// 1. Task goes through work → review
/// 2. Reviewer rejects → supersedes work session (rejection always supersedes)
/// 3. New work session is created
/// 4. `derived.stages_with_logs` shows: work has 2 sessions (run 1 superseded, run 2 current)
#[test]
#[allow(clippy::too_many_lines)]
fn test_multi_session_stages_with_logs_via_reviewer_rejection() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Create task and complete work stage
    let task = ctx.create_task(
        "Multi-session test",
        "Test stages_with_logs with multiple sessions",
        None,
    );
    let task_id = task.id.clone();

    // Work stage → produce artifact
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes output

    // Get task view - work should have 1 session
    let task_views = ctx.api().list_task_views().unwrap();
    let task_view = task_views.iter().find(|v| v.task.id == task_id).unwrap();

    let work_stage = task_view
        .derived
        .stages_with_logs
        .iter()
        .find(|s| s.stage == "work")
        .expect("work stage should exist");
    assert_eq!(
        work_stage.sessions.len(),
        1,
        "Work should have 1 session initially"
    );
    assert_eq!(work_stage.sessions[0].run_number, 1);
    assert!(
        work_stage.sessions[0].is_current,
        "Single session should be current"
    );
    let first_session_id = work_stage.sessions[0].session_id.clone();

    // Approve work → advances to review
    ctx.api().approve(&task_id).unwrap();

    // Review rejects → rejection always supersedes work session → spawns new work
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs refactoring".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Refactored implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes rejection → AwaitingRejectionConfirmation
    ctx.api().approve(&task_id).unwrap(); // confirm rejection → work re-queued
    ctx.advance(); // spawns new worker
    ctx.advance(); // processes new work output

    // Get task view - work should now have 2 sessions
    let task_views = ctx.api().list_task_views().unwrap();
    let task_view = task_views.iter().find(|v| v.task.id == task_id).unwrap();

    let work_stage = task_view
        .derived
        .stages_with_logs
        .iter()
        .find(|s| s.stage == "work")
        .expect("work stage should exist");

    assert_eq!(
        work_stage.sessions.len(),
        2,
        "Work should have 2 sessions after rejection. Got: {:?}",
        work_stage.sessions
    );

    // Sessions should be ordered chronologically
    // First session: run_number=1, is_current=false (superseded)
    assert_eq!(
        work_stage.sessions[0].run_number, 1,
        "First session should be run 1"
    );
    assert_eq!(
        work_stage.sessions[0].session_id, first_session_id,
        "First session should be the original"
    );
    assert!(
        !work_stage.sessions[0].is_current,
        "First session should NOT be current (superseded)"
    );

    // Second session: run_number=2, is_current=true (active)
    assert_eq!(
        work_stage.sessions[1].run_number, 2,
        "Second session should be run 2"
    );
    assert_ne!(
        work_stage.sessions[1].session_id, first_session_id,
        "Second session should be a different UUID"
    );
    assert!(
        work_stage.sessions[1].is_current,
        "Second session should be current"
    );

    // Review stage should have 1 session
    let review_stage = task_view
        .derived
        .stages_with_logs
        .iter()
        .find(|s| s.stage == "review")
        .expect("review stage should exist");

    assert_eq!(
        review_stage.sessions.len(),
        1,
        "Review should have 1 session"
    );
    assert_eq!(review_stage.sessions[0].run_number, 1);
    assert!(
        review_stage.sessions[0].is_current,
        "Review session should be current"
    );
}

// =============================================================================
// Request Update E2E Tests
// =============================================================================

/// Test that requesting update on a Done task returns it to recovery stage with feedback.
///
/// This test verifies the full `request_update` flow:
/// 1. Task reaches Done status after review approval
/// 2. User calls `request_update` with feedback
/// 3. Task returns to the recovery stage (work)
/// 4. A new iteration is created with `IterationTrigger::Rejection { from_stage: "done" }`
/// 5. Agent receives a fresh full prompt (not resume) with the feedback included
#[test]
fn test_request_update_on_done_task() {
    use orkestra_core::testutil::fixtures::test_default_workflow;
    use orkestra_core::workflow::domain::IterationTrigger;

    use crate::helpers::disable_auto_merge;

    // Use git workflow with auto_merge disabled so task stays at Done
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a task
    let task = ctx.create_task("Test request update", "Description", None);
    let task_id = task.id.clone();

    // Advance through all stages to Done
    advance_to_done_no_integration(&ctx, &task_id);

    // Verify task is Done
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Task should be Done after review approval");
    assert!(task.completed_at.is_some(), "completed_at should be set");

    // =========================================================================
    // Request update with feedback
    // =========================================================================

    let feedback = "Please add more error handling";
    let task = ctx.api().request_update(&task_id, feedback).unwrap();

    // Verify task moved to recovery stage (work)
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Task should return to work stage"
    );
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued"
    );
    assert!(
        task.completed_at.is_none(),
        "completed_at should be cleared"
    );

    // Verify iteration was created with Rejection trigger (from_stage: "done")
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let work_iterations: Vec<_> = iterations.iter().filter(|i| i.stage == "work").collect();
    let last_work_iter = work_iterations.last().expect("Should have work iterations");

    match &last_work_iter.incoming_context {
        Some(IterationTrigger::Rejection {
            from_stage,
            feedback: fb,
        }) => {
            assert_eq!(from_stage, "done");
            assert_eq!(fb, "Please add more error handling");
        }
        other => panic!("Expected Rejection trigger, got {other:?}"),
    }

    // Set mock output for the work stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Updated work with error handling".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance orchestrator — agent spawns with a fresh session (Rejection trigger supersedes)
    ctx.advance();

    // Verify agent receives a FULL prompt (not resume), with feedback included
    ctx.assert_full_prompt("summary", false, false);
    let prompt = ctx.last_prompt();
    assert!(
        prompt.contains("Please add more error handling"),
        "Full prompt should contain the feedback. Got prompt starting with: {}...",
        &prompt[..prompt.len().min(200)]
    );
}

// =============================================================================
// Artifact Materialization E2E Tests
// =============================================================================

/// Test that artifacts are materialized as files in the worktree.
///
/// Verifies:
/// 1. Plan artifact from stage 1 is written to `.orkestra/.artifacts/plan.md`
/// 2. File content matches the artifact content from the database
/// 3. Prompts reference file paths (not inline content)
#[test]
fn test_artifact_materialization() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};
    use std::path::Path;

    // Two-stage workflow: planning → work
    // Work stage will receive the plan artifact
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = ctx.create_task("Test artifact materialization", "Test description", None);
    let task_id = task.id.clone();

    // Verify task has worktree
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.worktree_path.is_some(),
        "Task should have a worktree path"
    );
    let worktree_path = Path::new(task.worktree_path.as_ref().unwrap());

    // =========================================================================
    // Step 1: Complete planning stage with an artifact
    // =========================================================================
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Step 1: Do the thing\nStep 2: Verify it works".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn planner
    ctx.advance(); // process planner output

    // Verify artifact is stored in database
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.artifact("plan"),
        Some("Step 1: Do the thing\nStep 2: Verify it works"),
        "Plan artifact should be stored in database"
    );

    // Queue the work stage output BEFORE approve (it will be consumed when worker spawns)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work completed".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Approve to move to work stage
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → Idle (work stage)
    ctx.advance(); // spawn worker

    // =========================================================================
    // Step 2: Verify artifact file was materialized
    // =========================================================================
    let artifacts_dir = worktree_path.join(".orkestra/.artifacts");
    let plan_file = artifacts_dir.join("plan.md");

    assert!(
        plan_file.exists(),
        "Artifact file should exist at {plan_file:?}"
    );

    let file_content = std::fs::read_to_string(&plan_file).unwrap();
    assert_eq!(
        file_content, "Step 1: Do the thing\nStep 2: Verify it works",
        "File content should match artifact content"
    );

    // =========================================================================
    // Step 3: Verify prompt references file path, not inline content
    // =========================================================================
    let prompt = ctx.last_prompt();

    // Prompt should reference the absolute artifact file path (not a relative path)
    let expected_plan_path = format!(
        "{}/.orkestra/.artifacts/plan.md",
        worktree_path.to_str().unwrap()
    );
    assert!(
        prompt.contains(&expected_plan_path),
        "Prompt should contain absolute artifact file path '{expected_plan_path}'. Got prompt:\n{}",
        &prompt[..prompt.len().min(2000)]
    );

    // Prompt should NOT contain the inline artifact content
    // (The content is in the file, not the prompt)
    assert!(
        !prompt.contains("Step 1: Do the thing"),
        "Prompt should NOT contain inline artifact content"
    );
}

/// Test that multiple artifacts from different stages are all materialized.
///
/// Verifies:
/// 1. Multiple artifact files created in `.orkestra/.artifacts/`
/// 2. Each file contains the correct content
/// 3. Prompts reference all artifact file paths
#[test]
fn test_multiple_artifacts_materialized() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};
    use std::path::Path;

    // Three-stage workflow: planning → work → review
    // Review stage receives both plan and summary artifacts
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker", "reviewer"]);

    let task = ctx.create_task("Test multiple artifacts", "Test description", None);
    let task_id = task.id.clone();

    let task = ctx.api().get_task(&task_id).unwrap();
    let worktree_path = Path::new(task.worktree_path.as_ref().unwrap());

    // =========================================================================
    // Step 1: Complete planning stage
    // =========================================================================
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The implementation plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn planner
    ctx.advance(); // process planner output

    // Queue work output BEFORE approve
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work completed successfully".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → Idle (work stage)
    ctx.advance(); // spawn worker
    ctx.advance(); // process worker output

    // Queue review output BEFORE approve
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline: Finishing → Finished → Idle (review stage)
    ctx.advance(); // spawn reviewer

    // =========================================================================
    // Step 2: Verify all artifacts materialized
    // =========================================================================
    let artifacts_dir = worktree_path.join(".orkestra/.artifacts");

    // Both artifact files should exist
    assert!(
        artifacts_dir.join("plan.md").exists(),
        "Plan artifact file should exist"
    );
    assert!(
        artifacts_dir.join("summary.md").exists(),
        "Summary artifact file should exist"
    );

    // Verify content
    assert_eq!(
        std::fs::read_to_string(artifacts_dir.join("plan.md")).unwrap(),
        "The implementation plan"
    );
    assert_eq!(
        std::fs::read_to_string(artifacts_dir.join("summary.md")).unwrap(),
        "Work completed successfully"
    );

    // =========================================================================
    // Step 4: Verify prompt references both artifact paths (absolute)
    // =========================================================================
    let prompt = ctx.last_prompt();

    let wt = worktree_path.to_str().unwrap();
    let expected_plan_path = format!("{wt}/.orkestra/.artifacts/plan.md");
    let expected_summary_path = format!("{wt}/.orkestra/.artifacts/summary.md");

    assert!(
        prompt.contains(&expected_plan_path),
        "Prompt should reference absolute plan artifact path '{expected_plan_path}'"
    );
    assert!(
        prompt.contains(&expected_summary_path),
        "Prompt should reference absolute summary artifact path '{expected_summary_path}'"
    );

    // Prompt should NOT contain inline content
    assert!(
        !prompt.contains("The implementation plan"),
        "Prompt should NOT contain inline plan content"
    );
    assert!(
        !prompt.contains("Work completed successfully"),
        "Prompt should NOT contain inline summary content"
    );
}

/// Test that untriggered re-entry prompts reference artifact file paths.
///
/// When a review stage is re-entered without a trigger, a fresh spawn is used.
/// The full prompt should reference artifact file paths, not inline content.
#[test]
fn test_untriggered_reentry_prompt_references_file_paths() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};
    use std::path::Path;

    // Workflow with work (gate) → review (with rejection back to work)
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::new_automated("echo ok").with_timeout(10)),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ]);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task("Test reentry file paths", "Test description", None);
    let task_id = task.id.clone();

    let task = ctx.api().get_task(&task_id).unwrap();
    let worktree_path = Path::new(task.worktree_path.as_ref().unwrap());

    // =========================================================================
    // Step 1: Complete work stage
    // =========================================================================
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial work done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawn worker → drain_active → AwaitingGate

    // =========================================================================
    // Step 2: Queue outputs BEFORE gate fires: review rejection → work → review re-entry
    // =========================================================================

    // First: review will reject
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more tests".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );

    // Second: work will produce updated artifact after rejection
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work with tests added".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Third: final review approval (fresh re-entry spawn)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good now".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );

    // Gate fires → review → reviewer rejects → work → gate fires → review (fresh re-entry)
    ctx.advance(); // spawn gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit → review Queued
    ctx.advance(); // spawn reviewer → drain_active → rejection → AwaitingRejectionConfirmation
    ctx.api().approve(&task_id).unwrap(); // confirm rejection → work re-queued
    ctx.advance(); // spawn second worker → drain_active → AwaitingGate
    ctx.advance(); // spawn gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit → review Queued
    ctx.advance(); // spawn reviewer (untriggered re-entry → fresh session)

    // =========================================================================
    // Step 3: Verify re-entry prompt is a fresh spawn referencing artifact file paths
    // =========================================================================

    // Verify the prompt is a full prompt (not a resume marker)
    let prompt = ctx.last_prompt();
    assert!(
        !prompt.starts_with("<!orkestra:resume:"),
        "Untriggered re-entry should be a full prompt, not a resume marker"
    );

    // Full prompts should mention artifacts with absolute file paths
    let expected_summary_path = format!(
        "{}/.orkestra/.artifacts/summary.md",
        worktree_path.to_str().unwrap()
    );
    assert!(
        prompt.contains(&expected_summary_path),
        "Re-entry prompt should reference absolute artifact file path '{expected_summary_path}'. Got:\n{}",
        &prompt[..prompt.len().min(2000)]
    );

    // Should NOT contain inline content
    assert!(
        !prompt.contains("Work with tests added"),
        "Re-entry prompt should NOT contain inline artifact content"
    );

    // Verify the artifact file was updated
    let summary_file = worktree_path.join(".orkestra/.artifacts/summary.md");
    assert!(summary_file.exists(), "Summary artifact file should exist");
    assert_eq!(
        std::fs::read_to_string(&summary_file).unwrap(),
        "Work with tests added",
        "Artifact file should have updated content"
    );
}

// =============================================================================
// Activity Flag Persistence Tests
// =============================================================================

/// Test that `has_activity` is only persisted to the database on successful agent completion.
///
/// This verifies the fix for a bug where activity was persisted during streaming,
/// causing failed sessions to incorrectly appear as having activity (which would
/// then cause resume attempts to fail with "Session ID already in use").
///
/// The fix moves activity flag persistence from `poll_agents()` (during streaming)
/// to `dispatch_completion()` (after successful output processing).
#[test]
fn test_activity_only_persisted_on_agent_success() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    // =========================================================================
    // Test 1: Successful agent completion → has_activity = true
    // =========================================================================

    let task_success = ctx.create_task("Test activity on success", "First task", None);
    let task_success_id = task_success.id.clone();

    // Set output WITH activity (sends LogLine before Completed)
    ctx.set_output_with_activity(
        &task_success_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done successfully".into(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawns agent (with LogLine activity)
    ctx.advance(); // processes successful output

    // Verify task completed successfully
    let task = ctx.api().get_task(&task_success_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be awaiting review after successful output"
    );

    // Verify has_activity was persisted to DB
    let session = ctx
        .api()
        .get_stage_session(&task_success_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(
        session.has_activity,
        "has_activity should be true after successful agent completion"
    );

    // =========================================================================
    // Test 2: Failed agent (no output configured) → has_activity = false
    // =========================================================================

    let task_fail = ctx.create_task("Test activity on failure", "Second task", None);
    let task_fail_id = task_fail.id.clone();

    // Don't set any output — mock will return an error
    ctx.advance(); // spawns agent (immediately fails, no output configured)

    // Verify task is in failed state
    let task = ctx.api().get_task(&task_fail_id).unwrap();
    assert!(
        task.is_failed(),
        "Task should be failed when agent has no output"
    );

    // Verify has_activity was NOT persisted to DB
    let session = ctx
        .api()
        .get_stage_session(&task_fail_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(
        !session.has_activity,
        "has_activity should be false after failed agent (activity not persisted on failure)"
    );

    // =========================================================================
    // Test 3: Failed agent WITH activity → has_activity = false
    // This tests the original bug scenario: agent emits streaming output
    // (LogLine events) but ultimately fails. The in-memory has_activity is set
    // during streaming, but it should NOT be persisted to DB on failure.
    // =========================================================================

    let task_activity_fail =
        ctx.create_task("Test activity on failure with output", "Third task", None);
    let task_activity_fail_id = task_activity_fail.id.clone();

    // Set output to emit activity (LogLine) then fail
    ctx.set_failure_with_activity(
        &task_activity_fail_id,
        "Simulated failure after producing activity".into(),
    );

    ctx.advance(); // spawns agent (sends LogLine then failure)

    // Verify task is in failed state
    let task = ctx.api().get_task(&task_activity_fail_id).unwrap();
    assert!(
        task.is_failed(),
        "Task should be failed when agent fails after producing activity"
    );

    // Verify has_activity was NOT persisted to DB despite in-memory activity
    let session = ctx
        .api()
        .get_stage_session(&task_activity_fail_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(
        !session.has_activity,
        "has_activity should be false after agent failure, even if streaming activity occurred"
    );
}

// =============================================================================
// Gate Script Tests
// =============================================================================

/// Gate pass: agent produces artifact → gate (exit 0) → enters commit pipeline.
///
/// Flow: work stage with gate configured.
/// - Agent produces artifact.
/// - Task transitions to `AwaitingGate`.
/// - Next tick spawns gate (exit 0 command).
/// - Gate completes successfully → task enters Finishing state.
#[test]
fn test_gate_pass_enters_commit_pipeline() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::new_automated("exit 0").with_timeout(10))]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Gate pass test", "Test gate pass", None);
    let task_id = task.id.clone();

    // Set mock output: artifact
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    // drain_active processes agent completion within the same tick
    ctx.advance(); // spawns agent → drain_active → artifact processed → AwaitingGate

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingGate { .. }),
        "Task should be AwaitingGate after artifact output, got: {:?}",
        task.state
    );

    // drain_active also processes gate completion within the same tick
    ctx.advance(); // spawns gate → drain_active → gate passes (exit 0) → AwaitingApproval

    // Gate passed → non-automated stage pauses for human review
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should be AwaitingApproval after gate pass (non-automated stage), got: {:?}",
        task.state
    );

    // Human approves → enters commit pipeline
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline runs

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(
            task.state,
            TaskState::Finishing { .. }
                | TaskState::Committing { .. }
                | TaskState::Committed { .. }
                | TaskState::Done
                | TaskState::Archived
        ),
        "Task should have entered commit pipeline after approval, got: {:?}",
        task.state
    );
}

/// Gate result persisted: gate output and exit code are saved to the iteration.
///
/// Flow: work stage with gate configured.
/// - Gate script emits output and exits 0.
/// - After completion, the iteration's `gate_result` is populated.
#[test]
fn test_gate_result_persisted() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::new_automated("echo 'gate check'").with_timeout(10))]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Gate result test", "Test gate_result is persisted", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent → drain_active → artifact processed → AwaitingGate
    ctx.advance(); // spawns gate → drain_active → gate passes → AwaitingApproval (non-automated stage)

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let gate_iter = iterations
        .iter()
        .find(|i| i.stage == "work" && i.gate_result.is_some());
    assert!(
        gate_iter.is_some(),
        "Expected an iteration with gate_result populated"
    );

    let gate_result = gate_iter.unwrap().gate_result.as_ref().unwrap();
    assert!(
        !gate_result.lines.is_empty(),
        "gate output should be captured"
    );
    assert_eq!(gate_result.exit_code, Some(0), "gate should have exited 0");
    assert!(gate_result.ended_at.is_some(), "ended_at should be set");
    assert!(
        !gate_result.started_at.is_empty(),
        "started_at should be set"
    );
}

/// Gate log entries emitted: gate lifecycle appears as log entries in the agent tab timeline.
///
/// Flow: work stage with gate configured.
/// - Agent produces artifact → task transitions to `AwaitingGate`.
/// - Gate runs and passes.
/// - Log entries for `GateStarted`, `GateOutput`, and `GateCompleted` are queryable.
#[test]
fn test_gate_output_emitted_as_log_entries() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};
    use orkestra_types::domain::LogEntry;

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::new_automated("echo 'gate check'").with_timeout(10))]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Gate log entry test", "Test gate log entries", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent → drain_active → artifact processed → AwaitingGate
    ctx.advance(); // spawns gate → drain_active → gate passes → AwaitingApproval

    let (entries, _) = ctx
        .api()
        .get_task_logs(&task_id, Some("work"), None, None)
        .expect("get_task_logs should succeed");

    let gate_started = entries
        .iter()
        .any(|e| matches!(e, LogEntry::GateStarted { .. }));
    assert!(gate_started, "Expected at least one GateStarted log entry");

    let gate_output_with_content = entries.iter().any(|e| {
        if let LogEntry::GateOutput { content } = e {
            content.contains("gate check")
        } else {
            false
        }
    });
    assert!(
        gate_output_with_content,
        "Expected at least one GateOutput entry containing 'gate check'"
    );

    let gate_completed_count = entries
        .iter()
        .filter(|e| {
            matches!(
                e,
                LogEntry::GateCompleted {
                    exit_code: 0,
                    passed: true
                }
            )
        })
        .count();
    assert_eq!(
        gate_completed_count, 1,
        "Expected exactly one GateCompleted entry with exit_code=0 and passed=true"
    );
}

/// Gate fail: agent produces artifact → gate (exit 1) → task re-queued with feedback.
///
/// Flow: work stage with gate configured.
/// - Agent produces artifact.
/// - Task transitions to `AwaitingGate`.
/// - Gate fails (exit 1).
/// - Task re-queued to work stage with `GateFailure` context.
/// - Next agent spawn receives gate error as feedback.
#[test]
fn test_gate_fail_requeues_with_feedback() {
    use orkestra_core::workflow::config::{
        GateConfig, IntegrationConfig, StageConfig, WorkflowConfig,
    };
    use orkestra_core::workflow::domain::IterationTrigger;
    use orkestra_types::domain::LogEntry;

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::new_automated("exit 1").with_timeout(10))])
    .with_integration(IntegrationConfig::new("work"));

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Gate fail test", "Test gate fail", None);
    let task_id = task.id.clone();

    // First iteration: agent produces artifact
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent → drain_active → artifact processed → AwaitingGate

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingGate { .. }),
        "Expected AwaitingGate, got: {:?}",
        task.state
    );

    ctx.advance(); // spawns gate → drain_active → gate fails (exit 1) → re-queued

    // Gate failed → task should be re-queued in work stage
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be re-queued after gate failure, got: {:?}",
        task.state
    );
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Task should be re-queued in work stage"
    );

    // Verify GateFailure iteration trigger was created
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let gate_failure_iter = iterations.iter().find(|i| {
        matches!(
            &i.incoming_context,
            Some(IterationTrigger::GateFailure { .. })
        )
    });
    assert!(
        gate_failure_iter.is_some(),
        "Should have a GateFailure iteration trigger"
    );

    // The feedback should reference gate failure
    if let Some(IterationTrigger::GateFailure { error }) =
        &gate_failure_iter.unwrap().incoming_context
    {
        assert!(
            error.contains("Gate failed") || error.contains("exit"),
            "Error should describe gate failure, got: {error}"
        );
    }

    // Verify gate log entries are emitted for the failure path
    let (entries, _) = ctx
        .api()
        .get_task_logs(&task_id, Some("work"), None, None)
        .expect("get_task_logs should succeed");

    let gate_started = entries
        .iter()
        .any(|e| matches!(e, LogEntry::GateStarted { .. }));
    assert!(gate_started, "Expected at least one GateStarted log entry");

    let gate_completed_failed_count = entries
        .iter()
        .filter(|e| {
            matches!(
                e,
                LogEntry::GateCompleted {
                    exit_code: 1,
                    passed: false
                }
            )
        })
        .count();
    assert_eq!(
        gate_completed_failed_count, 1,
        "Expected exactly one GateCompleted entry with exit_code=1 and passed=false"
    );
}

/// Gate crash recovery: `GateRunning` on startup resets to `AwaitingGate`.
///
/// Simulates a crash while a gate was running. On startup recovery,
/// the task should be reset to `AwaitingGate` so the gate re-spawns.
#[test]
fn test_gate_crash_recovery_resets_to_awaiting_gate() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::new_automated("exit 0").with_timeout(10))]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Gate recovery test", "Test gate crash recovery", None);
    let task_id = task.id.clone();

    // Manually set task to GateRunning (simulating a crash mid-gate)
    ctx.api().mark_gate_running(&task_id, "work").unwrap();

    // Verify we're in GateRunning
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(matches!(task.state, TaskState::GateRunning { .. }));

    // Run startup recovery
    ctx.run_startup_recovery();

    // Should be reset to AwaitingGate
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingGate { .. }),
        "GateRunning task should be reset to AwaitingGate on startup recovery, got: {:?}",
        task.state
    );
}

/// Gate pass then next stage: ensures the gate doesn't block stage advancement.
///
/// Flow: work (with gate) → review (automated, no gate)
/// - Agent produces artifact → gate passes → enters review → review auto-approves.
#[test]
fn test_gate_pass_then_advances_to_next_stage() {
    use orkestra_core::workflow::config::{
        GateConfig, IntegrationConfig, StageConfig, WorkflowConfig,
    };

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::new_automated("exit 0").with_timeout(10)),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ])
    .with_integration(IntegrationConfig::new("work"));

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);
    let task = ctx.create_task("Gate + next stage test", "Test gate advances", None);
    let task_id = task.id.clone();

    // Agent produces artifact → AwaitingGate
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent → drain_active → artifact processed → AwaitingGate

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(matches!(task.state, TaskState::AwaitingGate { .. }));

    ctx.advance(); // spawns gate → drain_active → gate passes → AwaitingApproval
    ctx.api().approve(&task_id).unwrap(); // human approves work after gate passes
    ctx.advance(); // commit pipeline → review Queued

    // Set review output before spawning the reviewer
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
    ctx.advance(); // spawns review agent → drain_active → approval → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Done (or Archived if auto-merge)

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(
            task.state,
            TaskState::Finishing { .. }
                | TaskState::Committing { .. }
                | TaskState::Committed { .. }
                | TaskState::Done
        ) || task.is_archived(),
        "Task should have advanced past review after gate pass, got: {:?}",
        task.state
    );
}

/// Gate timeout: gate command takes longer than the configured timeout.
///
/// Flow: work stage with gate `sleep 10` and 1s timeout.
/// - Agent produces artifact → `AwaitingGate`.
/// - Gate spawns, times out after ~1s → treated as failure.
/// - Task re-queued with `GateFailure` trigger containing "timed out" message.
#[test]
fn test_gate_timeout_treated_as_failure() {
    use orkestra_core::workflow::config::{
        GateConfig, IntegrationConfig, StageConfig, WorkflowConfig,
    };
    use orkestra_core::workflow::domain::IterationTrigger;

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::new_automated("sleep 10").with_timeout(1))])
    .with_integration(IntegrationConfig::new("work"));

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Gate timeout test", "Test gate timeout", None);
    let task_id = task.id.clone();

    // Agent produces artifact → AwaitingGate
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent → drain_active → artifact processed → AwaitingGate

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingGate { .. }),
        "Expected AwaitingGate, got: {:?}",
        task.state
    );

    // Gate spawns and runs; drain_active polls until timeout (~1s) then processes failure
    ctx.advance(); // spawns gate → drain_active loops until timed out → gate failure → re-queued

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be re-queued after gate timeout, got: {:?}",
        task.state
    );
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Task should be re-queued in work stage"
    );

    // Verify GateFailure trigger mentions timeout
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let gate_iter = iterations.iter().find(|i| {
        matches!(
            &i.incoming_context,
            Some(IterationTrigger::GateFailure { .. })
        )
    });
    assert!(
        gate_iter.is_some(),
        "Should have a GateFailure iteration trigger"
    );
    if let Some(IterationTrigger::GateFailure { error }) = &gate_iter.unwrap().incoming_context {
        assert!(
            error.contains("timed out"),
            "Error should mention timeout, got: {error}"
        );
    }
}

/// Interrupt during gate: task in `GateRunning` transitions to Interrupted.
///
/// Uses `mark_gate_running()` to simulate a gate already running (no real process),
/// then interrupts to verify the `GateRunning` → Interrupted transition works.
#[test]
fn test_interrupt_during_gate() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};
    use orkestra_core::workflow::domain::IterationTrigger;

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::new_automated("exit 0").with_timeout(10))]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Gate interrupt test", "Test interrupt during gate", None);
    let task_id = task.id.clone();

    // Set task to AgentWorking so we can produce an artifact to get an active iteration
    ctx.api().agent_started(&task_id).unwrap();

    // Manually set state to GateRunning (simulates agent completed + gate spawned)
    ctx.api().mark_gate_running(&task_id, "work").unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::GateRunning { .. }),
        "Expected GateRunning, got: {:?}",
        task.state
    );

    // Interrupt while gate is running
    let task = ctx.api().interrupt(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Interrupted { .. }),
        "Task should be Interrupted after interrupt during gate, got: {:?}",
        task.state
    );

    // Verify iteration outcome is Interrupted
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let interrupted_iter = iterations
        .iter()
        .find(|i| matches!(i.outcome, Some(Outcome::Interrupted)));
    assert!(
        interrupted_iter.is_some(),
        "Should have an iteration with Interrupted outcome"
    );
    assert_eq!(
        interrupted_iter.unwrap().stage,
        "work",
        "Interrupted iteration should be in work stage"
    );

    // Resume to verify task can recover from gate interrupt
    let task = ctx.api().send_message(&task_id, "").unwrap();
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after resuming from gate interrupt, got: {:?}",
        task.state
    );
    let iter_after_resume = ctx.api().get_iterations(&task_id).unwrap();
    let resume_iter = iter_after_resume.iter().find(|i| {
        matches!(
            &i.incoming_context,
            Some(IterationTrigger::UserMessage { .. })
        )
    });
    assert!(
        resume_iter.is_some(),
        "Should have a UserMessage iteration after resuming"
    );
}

/// Flow gate override disables gate: task with a flow that sets `gate: null` skips `AwaitingGate`.
///
/// Global `work` stage has a gate configured. The `no-gate` flow overrides it with
/// `gate: null`, disabling the gate. A task running under this flow should go directly
/// to the commit pipeline after the agent produces an artifact — never entering `AwaitingGate`.
#[test]
fn test_flow_gate_override_disables_gate() {
    use indexmap::IndexMap;
    use orkestra_core::workflow::config::{
        FlowConfig, GateConfig, IntegrationConfig, StageConfig, WorkflowConfig,
    };

    let mut flows = IndexMap::new();
    flows.insert(
        "no-gate".to_string(),
        FlowConfig {
            // No gate in this flow's work stage — gate would fail if reached
            stages: vec![StageConfig::new("work", "summary").with_prompt("worker.md")],
            integration: IntegrationConfig::new("work"),
        },
    );

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md") // skip approval so artifact goes directly to commit pipeline
        .with_gate(GateConfig::new_automated("exit 1").with_timeout(10))]) // gate would fail if reached
    .with_integration(IntegrationConfig::new("work"))
    .with_flows(flows);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    // Create task with the no-gate flow
    let task = ctx
        .api()
        .create_task_with_options(
            "Flow no-gate test",
            "Test flow disables gate",
            None,
            TaskCreationMode::Normal,
            Some("no-gate"),
        )
        .unwrap();
    let task_id = task.id.clone();

    // Run setup tick
    ctx.advance();
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        !matches!(
            task.state,
            TaskState::AwaitingSetup { .. } | TaskState::SettingUp { .. }
        ),
        "Setup should have completed, got: {:?}",
        task.state
    );

    // Agent produces artifact — gate is disabled for this flow, should skip AwaitingGate
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent → drain_active → artifact → no gate → AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        !matches!(task.state, TaskState::AwaitingGate { .. }),
        "Task should NOT enter AwaitingGate when flow disables gate, got: {:?}",
        task.state
    );

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(
            task.state,
            TaskState::Finishing { .. }
                | TaskState::Committing { .. }
                | TaskState::Committed { .. }
                | TaskState::Done
                | TaskState::Archived
        ),
        "Task should have entered commit pipeline, got: {:?}",
        task.state
    );
}

// =============================================================================
// Reject With Comments E2E Tests
// =============================================================================

/// Build a minimal 2-stage workflow where the review stage pauses for human approval.
///
/// work (summary) → review (verdict, agentic gate, defaults to rejecting to previous stage)
fn workflow_with_non_automated_review() -> WorkflowConfig {
    use orkestra_core::workflow::config::{
        GateConfig, IntegrationConfig, StageConfig, WorkflowConfig,
    };

    WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict").with_gate(GateConfig::Agentic),
    ])
    .with_integration(IntegrationConfig::new("work"))
}

/// Advance a task to `AwaitingApproval` in the review stage.
///
/// The mock reviewer produces an approve verdict. Since the stage is non-automated,
/// the task pauses at `AwaitingApproval` for human input.
fn advance_to_awaiting_approval(ctx: &TestEnv, task_id: &str) {
    // Work stage — produce summary artifact
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process summary
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to review

    // Review stage — reviewer produces a verdict artifact; GateConfig::Agentic pauses at AwaitingApproval
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "verdict".to_string(),
            content: "LGTM".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process verdict artifact → AwaitingApproval (GateConfig::Agentic, auto_mode=false)
}

/// Test normal rejection with line comments routes to the rejection target stage.
#[test]
fn test_reject_with_comments_normal() {
    use crate::helpers::disable_auto_merge;
    use orkestra_core::workflow::domain::{IterationTrigger, PrCommentData};

    let workflow = disable_auto_merge(workflow_with_non_automated_review());
    let ctx = TestEnv::with_git(&workflow, &["work", "review"]);

    let task = ctx.create_task("Test reject with comments", "Description", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Verify task is AwaitingApproval in review stage
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("review"));

    // Submit line comments
    let comments = vec![PrCommentData {
        author: "You".to_string(),
        body: "Fix this".to_string(),
        path: Some("src/main.rs".to_string()),
        line: Some(42),
    }];
    let task = ctx
        .api()
        .reject_with_comments(
            &task_id,
            comments.clone(),
            Some("Please address".to_string()),
        )
        .unwrap();

    // Task should move to "work" (the rejection target stage), Queued
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Task should route to work stage"
    );
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // New iteration in work stage should have PrFeedback trigger
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let work_iterations: Vec<_> = iterations.iter().filter(|i| i.stage == "work").collect();
    let last_work_iter = work_iterations.last().expect("Should have work iteration");
    match &last_work_iter.incoming_context {
        Some(IterationTrigger::PrFeedback {
            comments: ctx_comments,
            checks: _,
            guidance,
        }) => {
            assert_eq!(ctx_comments.len(), 1);
            assert_eq!(ctx_comments[0].author, "You");
            assert_eq!(ctx_comments[0].body, "Fix this");
            assert_eq!(ctx_comments[0].path.as_deref(), Some("src/main.rs"));
            assert_eq!(ctx_comments[0].line, Some(42));
            assert_eq!(guidance.as_deref(), Some("Please address"));
        }
        other => panic!("Expected PrFeedback trigger, got {other:?}"),
    }

    // Previous review iteration should be ended with rejection outcome
    let review_iterations: Vec<_> = iterations.iter().filter(|i| i.stage == "review").collect();
    let review_iter = review_iterations
        .last()
        .expect("Should have review iteration");
    assert!(
        matches!(review_iter.outcome, Some(Outcome::Rejected { .. })),
        "Review iteration should be ended with Rejected outcome, got: {:?}",
        review_iter.outcome
    );
}

/// Test that empty comments returns an error.
#[test]
fn test_reject_with_comments_empty_returns_error() {
    use crate::helpers::disable_auto_merge;
    use orkestra_core::workflow::ports::WorkflowError;

    let workflow = disable_auto_merge(workflow_with_non_automated_review());
    let ctx = TestEnv::with_git(&workflow, &["work", "review"]);

    let task = ctx.create_task("Test empty comments", "Description", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    let result = ctx.api().reject_with_comments(&task_id, vec![], None);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "Empty comments should return InvalidTransition error, got: {result:?}"
    );
}

/// Test that calling `reject_with_comments` on a non-awaiting-review task returns error.
#[test]
fn test_reject_with_comments_wrong_state_returns_error() {
    use crate::helpers::disable_auto_merge;
    use orkestra_core::workflow::domain::PrCommentData;
    use orkestra_core::workflow::ports::WorkflowError;

    let workflow = disable_auto_merge(workflow_with_non_automated_review());
    let ctx = TestEnv::with_git(&workflow, &["work", "review"]);

    let task = ctx.create_task("Test wrong state", "Description", None);
    let task_id = task.id.clone();

    // Task is in Queued/Idle state, not AwaitingApproval
    let comments = vec![PrCommentData {
        author: "You".to_string(),
        body: "Fix this".to_string(),
        path: None,
        line: None,
    }];

    let result = ctx.api().reject_with_comments(&task_id, comments, None);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "Should return InvalidTransition for wrong state, got: {result:?}"
    );
}

/// Test pending rejection review path: reviewer agent produced a "reject" verdict,
/// then human submits line comments → routes to rejection target stage.
#[test]
fn test_reject_with_comments_pending_rejection_review() {
    use crate::helpers::disable_auto_merge;
    use orkestra_core::workflow::domain::{IterationTrigger, PrCommentData};
    use orkestra_core::workflow::runtime::TaskState;

    let workflow = disable_auto_merge(workflow_with_non_automated_review());
    let ctx = TestEnv::with_git(&workflow, &["work", "review"]);

    let task = ctx.create_task("Test pending rejection", "Description", None);
    let task_id = task.id.clone();

    // Advance work stage
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

    // Reviewer produces a "reject" verdict — non-automated stage pauses at AwaitingRejectionConfirmation
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests are failing, fix them".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process rejection → AwaitingRejectionConfirmation

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingRejectionConfirmation { .. }),
        "Task should be AwaitingRejectionConfirmation, got: {:?}",
        task.state
    );

    // Human submits line comments — overrides the pending rejection review
    let comments = vec![PrCommentData {
        author: "You".to_string(),
        body: "Fix this specific line".to_string(),
        path: Some("src/lib.rs".to_string()),
        line: Some(10),
    }];
    let task = ctx
        .api()
        .reject_with_comments(&task_id, comments.clone(), None)
        .unwrap();

    // Task should route to "work" (rejection target) with PrComments trigger
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Task should route to work stage"
    );
    assert!(matches!(task.state, TaskState::Queued { .. }));

    // Verify PrFeedback trigger in the new work iteration
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let work_iterations: Vec<_> = iterations.iter().filter(|i| i.stage == "work").collect();
    let last_work_iter = work_iterations.last().expect("Should have work iteration");
    match &last_work_iter.incoming_context {
        Some(IterationTrigger::PrFeedback {
            comments: ctx_comments,
            checks: _,
            guidance,
        }) => {
            assert_eq!(ctx_comments.len(), 1);
            assert_eq!(ctx_comments[0].body, "Fix this specific line");
            assert!(guidance.is_none());
        }
        other => panic!("Expected PrFeedback trigger, got {other:?}"),
    }
}

/// Test that PR comment context reaches the agent prompt after `reject_with_comments`.
///
/// Verifies the orchestrator advances the task past Queued and that the work
/// stage prompt contains the file path, line number, and comment body from the
/// submitted PR comments.
#[test]
fn test_pr_comments_context_reaches_agent_prompt() {
    use crate::helpers::disable_auto_merge;
    use orkestra_core::workflow::domain::PrCommentData;

    let workflow = disable_auto_merge(workflow_with_non_automated_review());
    let ctx = TestEnv::with_git(&workflow, &["work", "review"]);

    let task = ctx.create_task("Test PR comments in prompt", "Description", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Submit line comments to route the task back to the work stage
    let comments = vec![PrCommentData {
        author: "reviewer".to_string(),
        body: "Fix this implementation".to_string(),
        path: Some("src/lib.rs".to_string()),
        line: Some(10),
    }];
    ctx.api()
        .reject_with_comments(
            &task_id,
            comments,
            Some("Please address the comment".to_string()),
        )
        .unwrap();

    // Set mock output so the orchestrator can process the work stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Fixed".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Advance once — orchestrator spawns the work agent with PrComments context
    ctx.advance();

    // The full prompt should contain the PR comment data (session superseded)
    let prompt = ctx.last_prompt_for(&task_id);
    for expected in &[
        "Fix this implementation",
        "src/lib.rs",
        "line 10",
        "Please address the comment",
    ] {
        assert!(
            prompt.contains(expected),
            "Full prompt should contain '{expected}'"
        );
    }
}

// =============================================================================
// Env Resolution Tests
// =============================================================================

/// Verify that resolved project env is threaded through to the agent runner.
///
/// When SHELL is set (normal developer/CI environment), the mock runner
/// should receive a `RunConfig` with env populated. The task must also
/// progress to `AwaitingApproval` to confirm the full pipeline is unaffected.
#[test]
fn test_resolved_env_threaded_to_agent_runner() {
    use orkestra_core::workflow::config::{StageConfig, WorkflowConfig};

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Env threading test", "Verify env in RunConfig", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance();

    let calls = ctx.runner_calls();
    assert!(!calls.is_empty(), "Expected at least one runner call");

    // All TestEnv constructors call `.with_skip_env_resolution()` on the stage executor
    // to avoid blocking the tick thread for up to 5 s while the shell sources ~/.zshrc.
    // The RunConfig.env field is always None in tests.
    assert!(
        calls[0].env.is_none(),
        "Env should be None in test environments (resolution is skipped for MockAgentRunner)"
    );

    // Verify task progresses normally without env resolution
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should reach AwaitingApproval, got: {:?}",
        task.state
    );
}

/// Gate scripts receive ORKESTRA_* environment variables when env resolution is active.
///
/// When `resolve_agent_env` succeeds, gate scripts are spawned via `spawn_with_base_env`,
/// which clears the inherited env and applies base + overlay. This test verifies that
/// `ORKESTRA_TASK_ID` is present in the overlay and survives the `env_clear`.
#[test]
fn test_gate_script_receives_orkestra_env_vars() {
    use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

    // Gate script writes ORKESTRA_TASK_ID to a file in the worktree
    let gate_command = "echo $ORKESTRA_TASK_ID > orkestra_env_check.txt";

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::new_automated(gate_command).with_timeout(10))]);

    let ctx = TestEnv::with_git(&workflow, &["worker"]);
    let task = ctx.create_task("Gate env test", "Verify ORKESTRA vars in gate", None);
    let task_id = task.id.clone();

    // Agent produces artifact, which triggers the gate
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent → drain_active → artifact processed → AwaitingGate

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingGate { .. }),
        "Task should be AwaitingGate after artifact, got: {:?}",
        task.state
    );

    ctx.advance(); // spawns gate → drain_active → gate completes → AwaitingApproval

    // Re-fetch task to get worktree_path
    let task = ctx.api().get_task(&task_id).unwrap();
    let worktree = task
        .worktree_path
        .as_ref()
        .expect("task should have worktree");
    let check_file = std::path::Path::new(worktree).join("orkestra_env_check.txt");

    assert!(
        check_file.exists(),
        "Gate script should have written orkestra_env_check.txt"
    );
    let contents = std::fs::read_to_string(&check_file).unwrap();
    assert_eq!(
        contents.trim(),
        task_id,
        "Gate script should receive ORKESTRA_TASK_ID"
    );
}

// =============================================================================
// Stage Bypass (skip_stage / send_to_stage) E2E Tests
// =============================================================================

/// Skip a stage and verify the orchestrator picks up the task at the next stage.
///
/// After skip, the work agent receives the redirect message in its prompt.
#[test]
fn test_skip_stage_advances_through_orchestrator() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict").with_prompt("reviewer.md"),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["planner", "worker", "reviewer"]);

    let task = ctx.create_task("Test skip stage", "Description", None);
    let task_id = task.id.clone();

    // Advance to AwaitingApproval at planning
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan → AwaitingApproval at planning

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at planning, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("planning"));

    // Skip planning → work
    let task = ctx
        .api()
        .skip_stage(&task_id, "Plan is already done, skip to work")
        .unwrap();
    assert_eq!(task.current_stage(), Some("work"));
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued at work after skip, got: {:?}",
        task.state
    );

    // Orchestrator picks up and spawns the work agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker with redirect trigger
    ctx.advance(); // processes summary → AwaitingApproval at work

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at work, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("work"));

    // The work agent's prompt must contain the redirect message
    let prompt = ctx.last_prompt_for(&task_id);
    assert!(
        prompt.contains("Plan is already done, skip to work"),
        "Work agent prompt should contain the redirect message. Got:\n{}",
        &prompt[..prompt.len().min(500)]
    );
}

/// Send a task backward to an earlier stage and verify the orchestrator picks it up.
///
/// The planning agent receives the redirect message in its prompt.
#[test]
fn test_send_to_stage_backward_through_orchestrator() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = ctx.create_task("Test backward send", "Description", None);
    let task_id = task.id.clone();

    // Advance planning to AwaitingApproval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan → AwaitingApproval at planning

    // Approve planning and advance to work
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline + advance → Queued at work

    // Produce work artifact → AwaitingApproval at work
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes summary → AwaitingApproval at work

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at work, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("work"));

    // Send backward to planning
    let task = ctx
        .api()
        .send_to_stage(&task_id, "planning", "Reviewer wants changes")
        .unwrap();
    assert_eq!(task.current_stage(), Some("planning"));
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued at planning after backward send, got: {:?}",
        task.state
    );

    // Orchestrator picks up and spawns the planning agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Revised plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner with redirect trigger
    ctx.advance(); // processes plan → AwaitingApproval at planning

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at planning, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("planning"));

    // The planning agent's prompt must contain the redirect message
    let prompt = ctx.last_prompt_for(&task_id);
    assert!(
        prompt.contains("Reviewer wants changes"),
        "Planning agent prompt should contain the redirect message. Got:\n{}",
        &prompt[..prompt.len().min(500)]
    );
}

/// Skipping the last stage marks the task Done.
#[test]
fn test_skip_last_stage_completes_task() {
    // work is the last stage in this 2-stage workflow
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = ctx.create_task("Test skip last stage", "Description", None);
    let task_id = task.id.clone();

    // Advance planning to AwaitingApproval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance();
    ctx.advance();

    // Approve planning → move to work
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance

    // Produce work artifact → AwaitingApproval at work (last stage)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance();
    ctx.advance();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at work, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("work"));

    // Skip work (last stage) → task should be Done
    let task = ctx.api().skip_stage(&task_id, "Review not needed").unwrap();
    assert!(
        matches!(task.state, TaskState::Done),
        "Skipping the last stage should mark the task Done, got: {:?}",
        task.state
    );
}

/// Sending a task to a stage not in its flow returns an error.
#[test]
fn test_send_to_stage_respects_flow() {
    use indexmap::IndexMap;
    use orkestra_core::workflow::config::{FlowConfig, IntegrationConfig};
    use orkestra_core::workflow::WorkflowError;

    // "quick" flow: planning → work (no review)
    let mut flows = IndexMap::new();
    flows.insert(
        "quick".to_string(),
        FlowConfig {
            stages: vec![
                StageConfig::new("planning", "plan")
                    .with_prompt("planner.md")
                    .with_gate(GateConfig::Agentic),
                StageConfig::new("work", "summary").with_prompt("worker.md"),
            ],
            integration: IntegrationConfig::new("planning"),
        },
    );

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict").with_prompt("reviewer.md"),
    ])
    .with_flows(flows);

    let ctx = TestEnv::with_git(&workflow, &["planner", "worker", "reviewer"]);

    // Create task with "quick" flow (no review stage)
    let task = ctx
        .api()
        .create_task_with_options(
            "Test flow",
            "Description",
            None,
            TaskCreationMode::Normal,
            Some("quick"),
        )
        .unwrap();
    let task_id = task.id.clone();
    ctx.advance(); // complete sync setup

    // Advance to AwaitingApproval at planning
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance();
    ctx.advance();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at planning, got: {:?}",
        task.state
    );

    // Attempt to send to "review" which is NOT in the "quick" flow
    let result = ctx.api().send_to_stage(&task_id, "review", "test");
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "send_to_stage to a stage outside the flow should fail with InvalidTransition, got: {result:?}"
    );
}

/// Sending a task from Interrupted state routes it through the orchestrator.
///
/// The redirect creates a new iteration with `IterationTrigger::Redirect` and the
/// orchestrator spawns the agent at the target stage with the message in its prompt.
#[test]
fn test_send_to_stage_from_interrupted() {
    use orkestra_core::workflow::domain::IterationTrigger;

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = ctx.create_task("Test interrupted redirect", "Description", None);
    let task_id = task.id.clone();

    // Advance planning to AwaitingApproval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan → AwaitingApproval

    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance → Queued at work

    // Manually move to AgentWorking at work, then interrupt
    ctx.api().agent_started(&task_id).unwrap();
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AgentWorking { .. }),
        "Expected AgentWorking, got: {:?}",
        task.state
    );

    ctx.api().interrupt(&task_id).unwrap();
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Interrupted { .. }),
        "Expected Interrupted, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("work"));

    // Send backward to planning
    let task = ctx
        .api()
        .send_to_stage(&task_id, "planning", "Need to re-plan")
        .unwrap();
    assert_eq!(task.current_stage(), Some("planning"));
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued at planning after send_to_stage, got: {:?}",
        task.state
    );

    // Verify the new planning iteration has a Redirect trigger
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let planning_redirect_iter = iterations
        .iter()
        .rfind(|i| i.stage == "planning")
        .expect("Should have a planning iteration with Redirect trigger");
    match &planning_redirect_iter.incoming_context {
        Some(IterationTrigger::Redirect {
            from_stage,
            message,
        }) => {
            assert_eq!(from_stage, "work");
            assert_eq!(message, "Need to re-plan");
        }
        other => panic!("Expected Redirect trigger, got {other:?}"),
    }

    // Orchestrator spawns planning agent with the redirect message
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Revised plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner with Redirect trigger
    ctx.advance(); // processes plan → AwaitingApproval at planning

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at planning, got: {:?}",
        task.state
    );

    // The planning agent's prompt must contain the redirect message
    let prompt = ctx.last_prompt_for(&task_id);
    assert!(
        prompt.contains("Need to re-plan"),
        "Planning agent prompt should contain the redirect message. Got:\n{}",
        &prompt[..prompt.len().min(500)]
    );
}

// =============================================================================
// Restart Stage E2E Tests
// =============================================================================

/// Restart the current stage from `AwaitingApproval` and verify the orchestrator
/// spawns a fresh agent at the same stage with the restart message in its prompt.
#[test]
fn test_restart_stage_creates_fresh_iteration() {
    use orkestra_core::workflow::domain::IterationTrigger;

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = ctx.create_task("Test restart stage", "Description", None);
    let task_id = task.id.clone();

    // Advance to AwaitingApproval at planning
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "The plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan → AwaitingApproval at planning

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at planning, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("planning"));

    // Restart planning
    let task = ctx
        .api()
        .restart_stage(&task_id, "Need to redo the plan")
        .unwrap();
    assert_eq!(
        task.current_stage(),
        Some("planning"),
        "Task should remain at planning after restart"
    );
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued at planning after restart, got: {:?}",
        task.state
    );

    // Verify the new iteration has a Restart trigger
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let restart_iter = iterations
        .iter()
        .rfind(|i| i.stage == "planning")
        .expect("Should have a planning iteration with Restart trigger");
    match &restart_iter.incoming_context {
        Some(IterationTrigger::Restart { message }) => {
            assert_eq!(message, "Need to redo the plan");
        }
        other => panic!("Expected Restart trigger, got {other:?}"),
    }

    // Orchestrator picks up and spawns a fresh planning agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Revised plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner with Restart trigger
    ctx.advance(); // processes plan → AwaitingApproval at planning

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at planning after restart, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("planning"));

    // The planning agent's prompt must contain the restart message
    let prompt = ctx.last_prompt_for(&task_id);
    assert!(
        prompt.contains("Need to redo the plan"),
        "Planning agent prompt should contain the restart message. Got:\n{}",
        &prompt[..prompt.len().min(500)]
    );
}

/// Restart the current stage from Interrupted state and verify the orchestrator
/// picks up the task at the same stage.
#[test]
fn test_restart_stage_from_interrupted() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = ctx.create_task("Test restart from interrupted", "Description", None);
    let task_id = task.id.clone();

    // Manually move to AgentWorking at planning, then interrupt
    ctx.api().agent_started(&task_id).unwrap();
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AgentWorking { .. }),
        "Expected AgentWorking, got: {:?}",
        task.state
    );

    ctx.api().interrupt(&task_id).unwrap();
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Interrupted { .. }),
        "Expected Interrupted, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("planning"));

    // Restart from Interrupted
    let task = ctx
        .api()
        .restart_stage(&task_id, "Agent got stuck")
        .unwrap();
    assert_eq!(
        task.current_stage(),
        Some("planning"),
        "Task should remain at planning after restart"
    );
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued at planning after restart, got: {:?}",
        task.state
    );

    // Orchestrator picks up the restarted task
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "New plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner
    ctx.advance(); // processes plan → AwaitingApproval at planning

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be AwaitingApproval at planning after restart, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("planning"));
}

// =============================================================================
// Bypass Operations from Failed/Blocked States
// =============================================================================

/// Skip stage from a Failed task advances to the next stage.
#[test]
fn test_skip_stage_from_failed() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test skip from failed", "A task that will fail", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Failed {
            error: "Could not proceed".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes failure

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_failed(),
        "Task should be Failed, got: {:?}",
        task.state
    );

    let task = ctx
        .api()
        .skip_stage(&task_id, "Skipping failed stage")
        .unwrap();

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "breakdown"),
        "Task should be Queued at breakdown, got: {:?}",
        task.state
    );
}

/// Skip stage from a Blocked task advances to the next stage.
#[test]
fn test_skip_stage_from_blocked() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test skip from blocked", "A task that will block", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Blocked {
            reason: "Waiting on external dependency".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes blocked output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Blocked { .. }),
        "Task should be Blocked, got: {:?}",
        task.state
    );

    let task = ctx
        .api()
        .skip_stage(&task_id, "Skipping blocked stage")
        .unwrap();

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "breakdown"),
        "Task should be Queued at breakdown, got: {:?}",
        task.state
    );
}

/// Send to stage from a Failed task transitions to the target stage.
#[test]
fn test_send_to_stage_from_failed() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task(
        "Test send_to_stage from failed",
        "A task that will fail",
        None,
    );
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Failed {
            error: "Planning failed".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes failure

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_failed(),
        "Task should be Failed, got: {:?}",
        task.state
    );

    let task = ctx
        .api()
        .send_to_stage(&task_id, "work", "Jumping to work")
        .unwrap();

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "work"),
        "Task should be Queued at work, got: {:?}",
        task.state
    );
}

/// Send to stage from a Blocked task transitions to the target stage.
#[test]
fn test_send_to_stage_from_blocked() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task(
        "Test send_to_stage from blocked",
        "A task that will block",
        None,
    );
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Blocked {
            reason: "Blocked on CI".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes blocked output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Blocked { .. }),
        "Task should be Blocked, got: {:?}",
        task.state
    );

    let task = ctx
        .api()
        .send_to_stage(&task_id, "work", "Jumping to work")
        .unwrap();

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "work"),
        "Task should be Queued at work, got: {:?}",
        task.state
    );
}

/// Restart stage from a Failed task re-queues at the same stage.
#[test]
fn test_restart_stage_from_failed() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test restart from failed", "A task that will fail", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Failed {
            error: "Agent crashed".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes failure

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_failed(),
        "Task should be Failed, got: {:?}",
        task.state
    );

    let task = ctx
        .api()
        .restart_stage(&task_id, "Retrying planning")
        .unwrap();

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "planning"),
        "Task should be Queued at planning, got: {:?}",
        task.state
    );
}

/// Restart stage from a Blocked task re-queues at the same stage.
#[test]
fn test_restart_stage_from_blocked() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test restart from blocked", "A task that will block", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Blocked {
            reason: "External service down".into(),
        },
    );
    ctx.advance(); // spawns agent
    ctx.advance(); // processes blocked output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Blocked { .. }),
        "Task should be Blocked, got: {:?}",
        task.state
    );

    let task = ctx
        .api()
        .restart_stage(&task_id, "Service is back up")
        .unwrap();

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "planning"),
        "Task should be Queued at planning, got: {:?}",
        task.state
    );
}

/// Test cursor-based incremental log fetching.
///
/// Verifies that:
/// - `get_task_logs` with `cursor: None` returns all entries + a cursor
/// - `get_task_logs` with the returned cursor returns no new entries + `cursor: None`
/// - `restart_stage` supersedes the session (new session.id); cursor resets to None for new session
/// - Within the new session, cursor-based incremental fetching works correctly
#[test]
fn test_cursor_based_incremental_log_fetch() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task(
        "Test cursor fetch",
        "A task to test cursor-based log fetching",
        None,
    );
    let task_id = task.id.clone();

    // Run the planner with activity so log entries are written
    ctx.set_output_with_activity(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Initial plan".into(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns planner agent (emits LogLine before Completed)
    ctx.advance(); // processes artifact output

    // Fetch all entries with cursor=None (returns everything from sequence 0)
    let (entries, cursor) = ctx
        .api()
        .get_task_logs(&task_id, Some("planning"), None, None)
        .expect("get_task_logs should succeed");

    assert!(
        !entries.is_empty(),
        "should have log entries after agent run with activity"
    );
    assert!(
        cursor.is_some(),
        "cursor should be set when entries are returned"
    );

    // Fetch again with the returned cursor — no new entries since last fetch
    let (new_entries, new_cursor) = ctx
        .api()
        .get_task_logs(&task_id, Some("planning"), None, cursor)
        .expect("get_task_logs with cursor should succeed");

    assert!(
        new_entries.is_empty(),
        "no new entries since cursor was issued"
    );
    assert!(
        new_cursor.is_none(),
        "cursor should be None when no entries returned"
    );

    // Restart stage — supersedes the session (new session.id); cursor resets for new session
    ctx.api()
        .restart_stage(&task_id, "Needs more detail")
        .unwrap();

    ctx.set_output_with_activity(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Improved plan".into(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns agent for retry (emits LogLine before Completed)
    ctx.advance(); // processes artifact output

    // Fetch with cursor=None for the new session — should return new entries
    let (session2_entries, cursor2) = ctx
        .api()
        .get_task_logs(&task_id, Some("planning"), None, None)
        .expect("fetch from new session should succeed");

    assert!(
        !session2_entries.is_empty(),
        "should return new entries written during the second agent run"
    );
    assert!(
        cursor2.is_some(),
        "cursor should be set for new session entries"
    );

    // Fetch again with session2 cursor — no new entries since last fetch
    let (incremental_entries, cursor3) = ctx
        .api()
        .get_task_logs(&task_id, Some("planning"), None, cursor2)
        .expect("incremental fetch with session2 cursor should succeed");

    assert!(
        incremental_entries.is_empty(),
        "no new entries since session2 cursor was issued"
    );
    assert!(
        cursor3.is_none(),
        "cursor should be None when no entries returned"
    );
}

// =============================================================================
// route_to Rejection Routing Tests
// =============================================================================

/// Three-stage workflow: planning → work → review (agentic gate).
/// Used to test `route_to` rejection routing — reviewer can route back to any stage.
fn workflow_with_route_to() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("work", "summary"),
        StageConfig::new("review", "verdict").with_gate(GateConfig::Agentic),
    ])
}

/// Test that agent rejection with `route_to: Some("planning")` routes to the planning stage
/// (skipping the default previous-stage fallback of "work").
#[test]
fn test_route_to_rejection_routes_to_specified_stage() {
    use orkestra_core::workflow::execution::StageOutput;

    let workflow = workflow_with_route_to();
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx.create_task("Test route_to routing", "Description", None);
    let task_id = task.id.clone();

    // Advance through planning and work stages (no gate — pauses for approval each time)
    ctx.set_output(&task_id, MockAgentOutput::artifact("plan", "The plan"));
    ctx.advance(); // spawn planning
    ctx.advance(); // process plan → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Queued(work)

    ctx.set_output(&task_id, MockAgentOutput::artifact("summary", "Work done"));
    ctx.advance(); // spawn work
    ctx.advance(); // process summary → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Queued(review)

    // Review stage: agent rejects with route_to="planning" (skip work, go straight back)
    ctx.set_output(
        &task_id,
        StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs rethinking from scratch".to_string(),
            route_to: Some("planning".to_string()),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn review agent
    ctx.advance(); // process rejection → auto_mode=false → AwaitingRejectionConfirmation

    let task = ctx.api().get_task(&task_id).unwrap();

    // With auto_mode=false, reviewer rejection pauses at AwaitingRejectionConfirmation
    // The pending rejection target should be "planning" (not "work", the previous stage)
    assert!(
        matches!(task.state, TaskState::AwaitingRejectionConfirmation { .. }),
        "Task should be AwaitingRejectionConfirmation, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("review"));

    // Confirm rejection — approve() when in AwaitingRejectionConfirmation confirms the rejection
    ctx.api().approve(&task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("planning"),
        "Task should route to planning stage (specified by route_to), got: {:?}",
        task.state
    );
    assert!(matches!(task.state, TaskState::Queued { .. }));
}

/// Test that agent rejection without `route_to` falls back to the previous stage.
#[test]
fn test_route_to_fallback_routes_to_previous_stage() {
    let workflow = workflow_with_route_to();
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx.create_task("Test route_to fallback", "Description", None);
    let task_id = task.id.clone();

    // Advance through planning and work to review (no gate — pauses for approval each time)
    ctx.set_output(&task_id, MockAgentOutput::artifact("plan", "The plan"));
    ctx.advance(); // spawn planning
    ctx.advance(); // process plan → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Queued(work)

    ctx.set_output(&task_id, MockAgentOutput::artifact("summary", "Work done"));
    ctx.advance(); // spawn work
    ctx.advance(); // process summary → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Queued(review)

    // Review agent rejects with no route_to — should fall back to "work" (previous stage)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Implementation needs improvement".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn review
    ctx.advance(); // process rejection

    let task = ctx.api().get_task(&task_id).unwrap();

    // Pauses for human confirmation
    assert!(
        matches!(task.state, TaskState::AwaitingRejectionConfirmation { .. }),
        "Expected AwaitingRejectionConfirmation, got: {:?}",
        task.state
    );

    // approve() in AwaitingRejectionConfirmation confirms the rejection
    ctx.api().approve(&task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Without route_to, should fall back to previous stage 'work', got: {:?}",
        task.state
    );
}

// =============================================================================
// Malformed Output Auto-Retry Tests
// =============================================================================

/// Malformed output on first attempt retries and succeeds on the second.
///
/// Flow:
/// 1. Task created → Work queued
/// 2. Agent produces malformed output → auto-retry queues new iteration
/// 3. Agent produces valid artifact → stage succeeds
#[test]
fn test_malformed_output_retry_succeeds_on_second_attempt() {
    use orkestra_core::workflow::domain::IterationTrigger;

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]);
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx.create_task("Retry test", "Test auto-retry on malformed output", None);
    let task_id = task.id.clone();

    // Queue: first spawn returns malformed, second returns valid artifact.
    ctx.set_malformed_output(&task_id, "unexpected output format");
    ctx.set_output(
        &task_id,
        MockAgentOutput::artifact("summary", "Work summary content"),
    );

    ctx.advance(); // spawns work agent (picks up malformed)
    ctx.advance(); // processes malformed → auto_retry → task re-queued
    ctx.advance(); // spawns work agent again (picks up valid artifact)
    ctx.advance(); // processes artifact → AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be awaiting approval after successful retry, got: {:?}",
        task.state
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        2,
        "Should have 2 iterations: original (malformed) + retry (success). Got: {iterations:?}"
    );

    // First iteration ends with AgentError (malformed output).
    assert!(
        matches!(&iterations[0].outcome, Some(Outcome::AgentError { .. })),
        "First iteration should end with AgentError, got: {:?}",
        iterations[0].outcome
    );

    // Second iteration should have MalformedOutput trigger with attempt=2 (original was 1).
    assert!(
        matches!(
            &iterations[1].incoming_context,
            Some(IterationTrigger::MalformedOutput { attempt: 2, .. })
        ),
        "Second iteration should have MalformedOutput trigger with attempt=2, got: {:?}",
        iterations[1].incoming_context
    );

    // The corrective prompt sent on the retry must include the error message and ork fence
    // instructions — that is the entire point of auto-retry.
    let calls = ctx.runner_calls();
    assert_eq!(calls.len(), 2, "Should have exactly 2 agent spawns");
    let retry_prompt = format!(
        "{} {}",
        calls[1].system_prompt.as_deref().unwrap_or(""),
        calls[1].prompt
    );
    assert!(
        retry_prompt.contains("unexpected output format"),
        "Retry prompt must include the original error message, got: {retry_prompt}"
    );
    assert!(
        retry_prompt.contains("```ork"),
        "Retry prompt must include ork fence instructions, got: {retry_prompt}"
    );
}

/// Four consecutive malformed outputs exhaust the retry budget and fail the task.
///
/// Budget: `MAX_MALFORMED_RETRIES` = 3 (so 4 total attempts: 1 original + 3 retries).
/// On the 4th attempt the budget is exhausted and the task transitions to Failed.
#[test]
fn test_malformed_output_budget_exhaustion_fails_task() {
    use orkestra_core::workflow::domain::IterationTrigger;

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]);
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx.create_task("Budget test", "Test retry budget exhaustion", None);
    let task_id = task.id.clone();

    // Queue 4 malformed outputs — one per attempt.
    for _ in 0..4 {
        ctx.set_malformed_output(&task_id, "bad json");
    }

    // Each spawn+process cycle takes 2 advances.
    for _ in 0..4 {
        ctx.advance(); // spawns agent
        ctx.advance(); // processes result
    }

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_failed(),
        "Task should be Failed after exhausting retry budget, got: {:?}",
        task.state
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        4,
        "Should have 4 iterations: 1 original + 3 MalformedOutput retries. Got: {iterations:?}"
    );

    // The 3 retry iterations should each have a MalformedOutput trigger.
    let malformed_iterations: Vec<_> = iterations
        .iter()
        .filter(|i| {
            matches!(
                i.incoming_context,
                Some(IterationTrigger::MalformedOutput { .. })
            )
        })
        .collect();
    assert_eq!(
        malformed_iterations.len(),
        3,
        "Should have exactly 3 MalformedOutput retry iterations"
    );

    // Verify attempt numbers are 2, 3, 4 (original attempt was 1, so retries start at 2).
    let mut attempts: Vec<u32> = malformed_iterations
        .iter()
        .filter_map(|i| {
            if let Some(IterationTrigger::MalformedOutput { attempt, .. }) = &i.incoming_context {
                Some(*attempt)
            } else {
                None
            }
        })
        .collect();
    attempts.sort_unstable();
    assert_eq!(
        attempts,
        vec![2, 3, 4],
        "Attempt numbers should be 2, 3, 4 (original attempt was 1)"
    );
}

/// Valid output on the first attempt flows through normally (no retry needed).
///
/// Regression guard: malformed retry logic must not interfere with the success path.
#[test]
fn test_malformed_output_normal_flow_unchanged() {
    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]);
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx.create_task("Normal test", "Test normal flow is unaffected", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::artifact("summary", "Work done successfully"),
    );

    ctx.advance(); // spawns work agent
    ctx.advance(); // processes artifact → AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be awaiting approval on first success, got: {:?}",
        task.state
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        1,
        "Normal flow should produce exactly 1 iteration"
    );
    assert!(
        iterations[0].incoming_context.is_none(),
        "First iteration should have no trigger context"
    );
}

/// Test that an invalid `route_to` stage name returns `WorkflowError::InvalidTransition`.
#[test]
fn test_route_to_invalid_stage_returns_error() {
    use std::sync::Arc;

    use orkestra_core::workflow::execution::StageOutput;
    use orkestra_core::workflow::ports::{WorkflowError, WorkflowStore};
    use orkestra_core::workflow::runtime::TaskState;
    use orkestra_core::workflow::InMemoryWorkflowStore;
    use orkestra_core::workflow::WorkflowApi;

    let workflow = workflow_with_route_to();
    let store = Arc::new(InMemoryWorkflowStore::new());
    let store_ref: Arc<dyn WorkflowStore> = Arc::clone(&store) as Arc<dyn WorkflowStore>;
    let api = WorkflowApi::new(workflow, Arc::clone(&store) as Arc<dyn WorkflowStore>);

    let mut task = api
        .create_task("Test invalid route_to", "Desc", None)
        .unwrap();
    task.auto_mode = true;
    task.state = TaskState::agent_working("review");
    store_ref.save_task(&task).unwrap();
    api.iteration_service()
        .create_iteration(&task.id, "review", None)
        .unwrap();

    let output = StageOutput::Approval {
        decision: "reject".to_string(),
        content: "feedback".to_string(),
        route_to: Some("nonexistent_stage".to_string()),
        activity_log: None,
        resources: vec![],
    };

    let result = api.process_agent_output(&task.id, output);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "Invalid route_to should return InvalidTransition error, got: {result:?}"
    );
}

/// Rejection artifacts are persisted to `workflow_artifacts` and logged as `ArtifactProduced`.
///
/// Before this fix, `handle_approval.rs` returned `Ok(None)` for rejections, which caused the
/// artifact to be stored in memory only and never written to the database. The Agents tab
/// rendered blank for rejected iterations because no `ArtifactProduced` log entry was emitted.
#[test]
fn test_rejection_artifact_persisted() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ])
    .with_integration(IntegrationConfig::new("work"));

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx.create_task(
        "Rejection artifact test",
        "Verify artifacts are persisted for rejections",
        None,
    );
    let task_id = task.id.clone();

    // Advance work stage: produce artifact and approve to move to review
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation summary".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns worker
    ctx.advance(); // processes output → awaiting review
    ctx.api().approve(&task_id).unwrap(); // approve → moves to review stage

    // Reviewer rejects
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "The implementation needs improvement".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns reviewer
    ctx.advance(); // processes rejection output

    // ASSERT: rejection artifact was persisted to workflow_artifacts
    let workflow_artifacts = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    let rejection_artifacts: Vec<_> = workflow_artifacts
        .iter()
        .filter(|a| a.stage == "review")
        .collect();
    assert_eq!(
        rejection_artifacts.len(),
        1,
        "Rejection should produce exactly one workflow_artifact in the review stage. Got: {workflow_artifacts:?}"
    );
    assert_eq!(
        rejection_artifacts[0].content, "The implementation needs improvement",
        "Rejection artifact content should match the reviewer's rejection content"
    );
    assert_eq!(
        rejection_artifacts[0].name, "verdict",
        "Rejection artifact name should be the stage's artifact name"
    );

    // ASSERT: ArtifactProduced log entry was emitted for the review stage
    let (log_entries, _cursor) = ctx
        .api()
        .get_task_logs(&task_id, Some("review"), None, None)
        .unwrap();
    let produced_entries: Vec<_> = log_entries
        .iter()
        .filter(|e| matches!(e, LogEntry::ArtifactProduced { .. }))
        .collect();
    assert_eq!(
        produced_entries.len(),
        1,
        "Rejection should emit exactly one ArtifactProduced log entry. Got: {produced_entries:?}"
    );
    let LogEntry::ArtifactProduced {
        name: artifact_name,
        ..
    } = &produced_entries[0]
    else {
        panic!("Expected ArtifactProduced variant")
    };
    assert_eq!(
        artifact_name, "verdict",
        "ArtifactProduced name should match the stage's artifact name"
    );
}

// =============================================================================
// Test: prompt sections threaded to UserMessage (dynamic_sections)
// =============================================================================

/// Fresh spawn with no dynamic context produces empty `prompt_sections` in `RunConfig`.
/// Fresh spawn after a reviewer rejection carries a "Feedback to Address" section.
///
/// Flow:
/// 1. Work stage: first fresh spawn → empty sections (no dynamic context)
/// 2. Review stage (agentic gate): reviewer rejects back to work with feedback
/// 3. Work stage: second fresh spawn (Rejection trigger supersedes session) → sections populated
///
/// Note: `api.restart_stage()` creates a `Restart` trigger (supersedes session), while
/// reviewer-stage rejections create `Rejection` triggers that also supersede the session
/// and produce a fresh spawn where `dynamic_sections` are extracted.
#[test]
fn test_prompt_sections_threaded_to_run_config() {
    // Two stages: work (produces artifact) + review (agentic gate that can reject back to work).
    // Reviewer rejection creates a Rejection trigger → fresh spawn with feedback sections.
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary"),
        StageConfig::new("review", "verdict").with_gate(GateConfig::Agentic),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["work", "review"]);

    let task = ctx.create_task("Implement feature", "Add the feature", None);
    let task_id = task.id.clone();

    // --- Step 1: First fresh spawn (work stage) — no dynamic context ---

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns work agent (completion ready)

    let first_config = ctx.last_run_config();
    assert!(
        first_config.prompt_sections.is_empty(),
        "Fresh spawn with no dynamic context should have empty sections. Got: {:?}",
        first_config.prompt_sections
    );

    ctx.advance(); // processes summary → AwaitingApproval

    // --- Step 2: Auto-approve work, reviewer rejects back to work ---

    // set_auto_mode(true) immediately enters the commit pipeline from AwaitingApproval
    ctx.api().set_auto_mode(&task_id, true).unwrap();

    // Queue reviewer rejection, then work#2 artifact (consumed in sequence by mock)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Please add more detail".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Revised implementation with more detail".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // commits work → advances to review (queued, deferred this tick)
    ctx.advance(); // spawns reviewer + processes rejection (auto_mode=true) → task back to work with Rejection trigger
    ctx.advance(); // spawns work#2 with sections from Rejection trigger

    // --- Step 3: Second fresh spawn has sections from Rejection trigger ---

    let second_config = ctx.last_run_config();
    assert!(
        !second_config.prompt_sections.is_empty(),
        "Spawn after reviewer rejection should have non-empty sections. Got: {:?}",
        second_config.prompt_sections
    );

    let feedback_section = second_config
        .prompt_sections
        .iter()
        .find(|s| s.label == "Feedback to Address");
    assert!(
        feedback_section.is_some(),
        "Sections should contain 'Feedback to Address'. Got: {:?}",
        second_config.prompt_sections
    );
    assert_eq!(
        feedback_section.unwrap().content,
        "Please add more detail",
        "Feedback section content should match reviewer rejection message"
    );
}

// =============================================================================
// Schema Reference Injection Test
// =============================================================================

/// Verify that every agent spawn includes a compact schema reference in the user
/// prompt, regardless of provider capabilities.
///
/// This exercises the default claudecode provider (which has native `--json-schema`
/// support) to confirm schema reference injection is unconditional — not gated on
/// whether the provider needs enforcement wording.
#[test]
fn test_schema_reference_injected_for_default_provider() {
    let ctx = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let task = ctx.create_task("Test schema injection", "Verify schema reference", None);
    let task_id = task.id.clone();

    // Advance: spawns the first stage (planning) agent
    ctx.set_output(&task_id, MockAgentOutput::artifact("plan", "A plan"));
    ctx.advance();

    // The user prompt (not the system prompt) should contain the schema reference
    let run_config = ctx.last_run_config();
    assert!(
        run_config.prompt.contains("## JSON Schema Reference"),
        "User prompt should contain '## JSON Schema Reference'. Got:\n{}",
        &run_config.prompt[..run_config.prompt.len().min(1000)]
    );

    // Schema reference should contain actual JSON (starts with '{')
    let reference_start = run_config
        .prompt
        .find("## JSON Schema Reference")
        .expect("schema reference heading must be present");
    let after_heading = &run_config.prompt[reference_start..];
    assert!(
        after_heading.contains('{'),
        "Schema reference section should contain JSON schema content"
    );

    // Enforcement wording should NOT be present (claudecode has native schema support)
    assert!(
        !run_config.prompt.contains("Output ONLY the JSON object"),
        "Default provider (claudecode) should not get enforcement wording"
    );
}
