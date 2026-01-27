//! Exhaustive end-to-end test for the new standalone workflow system.
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
    domain::{Question, QuestionAnswer, QuestionOption, Task},
    execution::StageOutput,
    runtime::{Outcome, Phase},
    Git2GitService, GitService, MockAgentRunner, OrchestratorLoop, SqliteWorkflowStore,
    StageExecutionService, WorkflowApi,
};

// =============================================================================
// Mock Agent Output - Ergonomic test helper that converts to StageOutput
// =============================================================================

/// Simulated output from Claude Code agent.
///
/// This is a test convenience type that converts to the actual `StageOutput`.
#[derive(Debug, Clone)]
pub enum MockAgentOutput {
    /// Agent is asking clarifying questions
    Questions(Vec<Question>),
    /// Agent produced an artifact (plan, summary, verdict)
    Artifact { name: String, content: String },
    /// Agent (reviewer) is restaging to another stage
    Restage { target: String, feedback: String },
    /// Agent failed
    Failed { error: String },
    /// Agent is blocked
    Blocked { reason: String },
}

impl From<MockAgentOutput> for StageOutput {
    fn from(mock: MockAgentOutput) -> Self {
        match mock {
            MockAgentOutput::Questions(questions) => StageOutput::Questions { questions },
            MockAgentOutput::Artifact { content, .. } => StageOutput::Artifact { content },
            MockAgentOutput::Restage { target, feedback } => {
                StageOutput::Restage { target, feedback }
            }
            MockAgentOutput::Failed { error } => StageOutput::Failed { error },
            MockAgentOutput::Blocked { reason } => StageOutput::Blocked { reason },
        }
    }
}

// =============================================================================
// Test Setup
// =============================================================================

struct TestContext {
    api: Arc<Mutex<WorkflowApi>>,
    orchestrator: OrchestratorLoop,
    runner: Arc<MockAgentRunner>,
    temp_dir: TempDir,
}

impl TestContext {
    /// Create a task and wait for async setup to complete.
    /// Returns the task in Idle phase (or Failed if setup failed).
    fn create_task(&self, title: &str, desc: &str) -> Task {
        let task = self
            .api()
            .create_task(title, desc, None)
            .expect("Should create task");
        let task_id = task.id.clone();

        // Wait for async setup to complete (worktree creation)
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(20));
            let task = self.api().get_task(&task_id).expect("Should get task");
            if task.phase != Phase::SettingUp {
                return task;
            }
        }

        panic!("Task setup did not complete in time for task {task_id}");
    }

    /// Run orchestrator until all queued agent work completes.
    /// This handles cases like restage where multiple agents run in sequence.
    fn tick(&self) {
        // Keep ticking until no more agents are running
        for _ in 0..10 {
            self.orchestrator.tick().expect("Tick should succeed");
            // Wait for mock runner's async callback to complete
            std::thread::sleep(Duration::from_millis(30));

            // Check if any agents are still active
            if self.orchestrator.active_count() == 0 {
                // One more tick to ensure all events are processed
                self.orchestrator.tick().expect("Final tick should succeed");
                break;
            }
        }
    }

    /// Set the output for the next agent spawn for a task.
    fn set_output(&self, task_id: &str, output: impl Into<StageOutput>) {
        self.runner.set_output(task_id, output.into());
    }

    /// Get the API lock for human actions.
    fn api(&self) -> std::sync::MutexGuard<'_, WorkflowApi> {
        self.api.lock().unwrap()
    }

    /// Get the number of calls made to the runner.
    fn call_count(&self) -> usize {
        self.runner.calls().len()
    }

    /// Get the repository path for creating conflicts on main branch.
    fn repo_path(&self) -> &std::path::Path {
        self.temp_dir.path()
    }

    // =========================================================================
    // Prompt Verification Helpers
    // =========================================================================

    /// Get the last prompt sent to the agent.
    fn last_prompt(&self) -> String {
        let calls = self.runner.calls();
        calls
            .last()
            .expect("No agent calls recorded")
            .prompt
            .clone()
    }

    /// Assert that the last prompt has a specific resume marker type and contains expected strings.
    fn assert_resume_prompt_contains(&self, expected_type: &str, expected_content: &[&str]) {
        let prompt = self.last_prompt();
        let expected_marker = format!("<!orkestra-resume:{expected_type}>");
        assert!(
            prompt.starts_with(&expected_marker),
            "Expected resume marker '{}', got prompt starting with: {}...",
            expected_marker,
            &prompt[..prompt.len().min(100)]
        );

        for content in expected_content {
            assert!(
                prompt.contains(content),
                "Resume prompt should contain '{content}'. Full prompt:\n{prompt}"
            );
        }
    }

    /// Assert that the last prompt is a full prompt with expected stage characteristics.
    ///
    /// # Arguments
    /// * `artifact` - The artifact name this stage produces (e.g., "plan", "summary", "verdict")
    /// * `can_ask_questions` - Whether the stage has `ask_questions` capability
    /// * `restage_targets` - Stages this stage can restage to (empty if no restage capability)
    fn assert_full_prompt(
        &self,
        artifact: &str,
        can_ask_questions: bool,
        restage_targets: &[&str],
    ) {
        let prompt = self.last_prompt();

        // Should NOT be a resume prompt
        assert!(
            !prompt.starts_with("<!orkestra-resume:"),
            "Expected full prompt (not resume), but got resume prompt starting with: {}...",
            &prompt[..prompt.len().min(100)]
        );

        // Full prompts should contain the task section
        assert!(
            prompt.contains("## Your Current Task"),
            "Full prompt should contain '## Your Current Task' section"
        );

        // Should contain the expected artifact name in output format
        let artifact_pattern = format!("\"{artifact}\"");
        assert!(
            prompt.contains(&artifact_pattern),
            "Full prompt should reference artifact '{}'. Got prompt: {}...",
            artifact,
            &prompt[..prompt.len().min(500)]
        );

        // Check questions capability
        if can_ask_questions {
            assert!(
                prompt.contains("\"questions\""),
                "Prompt for stage with ask_questions should mention questions output type"
            );
        }

        // Check restage capability
        for target in restage_targets {
            assert!(
                prompt.contains("restage") || prompt.contains("rejected"),
                "Prompt for stage with restage capability should mention restage/rejected"
            );
            assert!(
                prompt.contains(target),
                "Prompt should mention restage target '{}' but doesn't. Prompt: {}...",
                target,
                &prompt[..prompt.len().min(500)]
            );
        }
    }
}

fn setup_test() -> TestContext {
    // Create git repo instead of plain temp dir
    let temp_dir = create_temp_git_repo().expect("Failed to create git repo");

    // Create workflow config file
    let orkestra_dir = temp_dir.path().join(".orkestra");
    std::fs::create_dir_all(&orkestra_dir).unwrap();

    // Create agent definition files (required by resolve_stage_agent_config)
    let agents_dir = orkestra_dir.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(agents_dir.join("planner.md"), "You are a planner agent.").unwrap();
    std::fs::write(
        agents_dir.join("breakdown.md"),
        "You are a breakdown agent.",
    )
    .unwrap();
    std::fs::write(agents_dir.join("worker.md"), "You are a worker agent.").unwrap();
    std::fs::write(agents_dir.join("reviewer.md"), "You are a reviewer agent.").unwrap();

    // Create workflow config file
    let workflow_path = orkestra_dir.join("workflow.yaml");
    let workflow = WorkflowConfig::default();
    let yaml = serde_yaml::to_string(&workflow).unwrap();
    std::fs::write(&workflow_path, yaml).unwrap();

    // Load it back (tests the loader)
    let loaded_workflow = load_workflow(&workflow_path).expect("Should load workflow");

    // Create real SQLite database in the temp directory
    let db_path = orkestra_dir.join("orkestra.db");
    let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
    let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
        Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

    // Initialize git service for worktree support
    let git_service: Arc<dyn GitService> =
        Arc::new(Git2GitService::new(temp_dir.path()).expect("Git service should init"));

    // Use WorkflowApi::with_git for real git integration
    let api = Arc::new(Mutex::new(WorkflowApi::with_git(
        loaded_workflow.clone(),
        Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
        git_service,
    )));
    let project_root = PathBuf::from(temp_dir.path());

    // Get iteration service from api
    let iteration_service = api.lock().unwrap().iteration_service().clone();

    // Create mock runner for testing
    let runner = Arc::new(MockAgentRunner::new());

    let stage_executor = Arc::new(StageExecutionService::with_runner(
        loaded_workflow,
        project_root,
        store,
        iteration_service,
        runner.clone(),
    ));

    let orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);

    TestContext {
        api,
        orchestrator,
        runner,
        temp_dir,
    }
}

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
    let ctx = setup_test();

    // =========================================================================
    // Step 1: Task created → Planning
    // =========================================================================
    let task = ctx.create_task(
        "Implement feature X",
        "Add the new feature X with full test coverage",
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
        Question::new("q1", "Which database should we use?")
            .with_context("The feature requires persistent storage")
            .with_options(vec![
                QuestionOption::new("postgres", "PostgreSQL")
                    .with_description("Best for complex queries"),
                QuestionOption::new("sqlite", "SQLite").with_description("Simple, file-based"),
            ]),
        Question::new("q2", "Should we add caching?"),
    ];
    ctx.set_output(&task_id, MockAgentOutput::Questions(questions));
    ctx.tick();

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
            "q1",
            "Which database should we use?",
            "PostgreSQL",
            chrono::Utc::now().to_rfc3339(),
        ),
        QuestionAnswer::new(
            "q2",
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
    ctx.tick();

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
    ctx.tick();

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
    ctx.tick();

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
    ctx.tick();

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
    ctx.tick();

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
    ctx.tick();

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
    ctx.tick();

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
    ctx.tick();

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
    ctx.tick();

    // Auto-integration should have completed successfully and task becomes Archived
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "Task should be Archived after integration"
    );
    assert!(task.completed_at.is_some(), "Should have completed_at set");
    // Note: worktree_path is preserved for log access even after integration

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

    // Question history is now stored in iteration contexts (IterationTrigger::Answers),
    // not on the task. The answers were already verified in the resume prompt assertions above.

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
    let ctx = setup_test();

    // Create task and get to work stage (waits for async setup)
    let task = ctx.create_task("Test", "Test task");
    let task_id = task.id.clone();

    // Planning stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
        },
    );
    ctx.tick();
    ctx.api().approve(&task_id).unwrap();

    // Breakdown stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Breakdown".to_string(),
        },
    );
    ctx.tick();
    ctx.api().approve(&task_id).unwrap();

    // Now we're in work stage - try to restage from work (which doesn't have restage capability)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Restage {
            target: "planning".to_string(),
            feedback: "Should fail".to_string(),
        },
    );
    ctx.tick();

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
    let ctx = setup_test();
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

    // Create agent definition files
    let agents_dir = orkestra_dir.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(agents_dir.join("planner.md"), "You are a planner agent.").unwrap();
    std::fs::write(agents_dir.join("worker.md"), "You are a worker agent.").unwrap();
    std::fs::write(agents_dir.join("reviewer.md"), "You are a reviewer agent.").unwrap();

    // Create workflow config with custom on_failure (no breakdown stage)
    let workflow_path = orkestra_dir.join("workflow.yaml");
    let yaml = r"
version: 1
stages:
  - name: planning
    artifact: plan
  - name: work
    artifact: summary
  - name: review
    artifact: verdict
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
    // The script uses a marker file to track state
    let scripts_dir = temp_dir.path().join("scripts");
    std::fs::create_dir_all(&scripts_dir).unwrap();
    let script_path = scripts_dir.join("checks.sh");
    std::fs::write(
        &script_path,
        r#"#!/bin/bash
MARKER_FILE="${ORKESTRA_MARKER_DIR:-/tmp}/script_passed_once"

if [ -f "$MARKER_FILE" ]; then
    echo "Checks passed!"
    exit 0
else
    mkdir -p "$(dirname "$MARKER_FILE")"
    touch "$MARKER_FILE"
    echo "Checks failed - missing marker"
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
            StageConfig::new("work", "summary"),
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
                .with_inputs(vec!["summary".into(), "check_results".into()])
                .automated(),
        ],
        integration: IntegrationConfig::default(),
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
    let script_fail_iter = iterations.iter().find(|i| {
        matches!(
            i.outcome.as_ref(),
            Some(Outcome::ScriptFailed { .. })
        )
    });
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
    assert!(task.is_done() || task.is_archived(), "Task should be done/archived");

    // Verify the complete iteration history
    let iterations = api.lock().unwrap().get_iterations(&task_id).unwrap();

    // Check that we have script failed iteration
    let script_fail_iter = iterations.iter().find(|i| {
        matches!(i.outcome.as_ref(), Some(Outcome::ScriptFailed { .. }))
    });
    assert!(
        script_fail_iter.is_some(),
        "Should have ScriptFailed iteration"
    );

    // Check that checks stage passed (approved) at some point
    let checks_passed = iterations.iter().any(|i| {
        i.stage == "checks" && matches!(i.outcome.as_ref(), Some(Outcome::Approved))
    });
    assert!(checks_passed, "Checks stage should have passed (approved)");

    // Check that review completed
    let review_approved = iterations.iter().any(|i| {
        i.stage == "review" && matches!(i.outcome.as_ref(), Some(Outcome::Approved))
    });
    assert!(review_approved, "Review stage should have completed");

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
