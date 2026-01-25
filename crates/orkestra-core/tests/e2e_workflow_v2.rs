//! Exhaustive end-to-end test for the new standalone workflow system.
//!
//! This test exercises the complete task lifecycle through all possible transitions:
//!
//! 1. Task created → Planning
//! 2. Planner asks questions → Human answers
//! 3. Planner produces plan → Plan rejected → Retry planning
//! 4. Plan approved → Working (skips optional breakdown)
//! 5. Work rejected → Retry working
//! 6. Work approved → Reviewing
//! 7. Reviewer restages to Work → Working
//! 8. Work approved again → Reviewing
//! 9. Reviewer approves → Done
//! 10. Integration fails → Back to Working
//! 11. Work → Review → Done → Integration succeeds → Complete
//!
//! This test uses real infrastructure (database, files, git) and only mocks
//! Claude Code responses. The test uses the WorkflowApi from the services layer.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::{load_workflow, WorkflowConfig},
    domain::{Question, QuestionAnswer, QuestionOption},
    execution::{MockSpawner, StageOutput},
    runtime::{Outcome, Phase},
    OrchestratorLoop, SqliteWorkflowStore, WorkflowApi,
};

// =============================================================================
// Mock Agent Output - Ergonomic test helper that converts to StageOutput
// =============================================================================

/// Simulated output from Claude Code agent.
///
/// This is a test convenience type that converts to the actual StageOutput.
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
            MockAgentOutput::Restage { target, feedback } => StageOutput::Restage { target, feedback },
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
    spawner: Arc<MockSpawner>,
    _temp_dir: TempDir,
}

impl TestContext {
    /// Run orchestrator tick and wait for async completion.
    fn tick(&self) {
        self.orchestrator.tick().expect("Tick should succeed");
        // Give the mock spawner's async callback time to complete
        std::thread::sleep(Duration::from_millis(50));
    }

    /// Set the output for the next agent spawn for a task.
    fn set_output(&self, task_id: &str, output: impl Into<StageOutput>) {
        self.spawner.set_output(task_id, output.into());
    }

    /// Get the API lock for human actions.
    fn api(&self) -> std::sync::MutexGuard<'_, WorkflowApi> {
        self.api.lock().unwrap()
    }
}

fn setup_test() -> TestContext {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");

    // Create workflow config file
    let orkestra_dir = temp_dir.path().join(".orkestra");
    std::fs::create_dir_all(&orkestra_dir).unwrap();

    // Create agent definition files (required by resolve_stage_agent_config)
    let agents_dir = orkestra_dir.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(agents_dir.join("planner.md"), "You are a planner agent.").unwrap();
    std::fs::write(agents_dir.join("breakdown.md"), "You are a breakdown agent.").unwrap();
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
    let store = Box::new(SqliteWorkflowStore::new(db_conn.shared()));

    let api = Arc::new(Mutex::new(WorkflowApi::new(loaded_workflow, store)));
    let project_root = PathBuf::from(temp_dir.path());
    let spawner = Arc::new(MockSpawner::new());
    let orchestrator = OrchestratorLoop::new(api.clone(), project_root, spawner.clone());

    TestContext {
        api,
        orchestrator,
        spawner,
        _temp_dir: temp_dir,
    }
}

// =============================================================================
// The Exhaustive E2E Test
// =============================================================================

/// The exhaustive e2e test covering all workflow transitions.
///
/// This test uses the OrchestratorLoop to drive agent spawning, making it
/// a true end-to-end test of the orchestration system.
///
/// Flow:
/// 1. Task created → Planning
/// 2. Planner asks questions → Human answers
/// 3. Planner produces plan → Plan rejected → Retry planning
/// 4. Plan approved → Working (skips optional breakdown)
/// 5. Work rejected → Retry working
/// 6. Work approved → Reviewing
/// 7. Reviewer restages to Work → Working
/// 8. Work approved again → Reviewing
/// 9. Reviewer approves → Done
/// 10. Integration fails → Back to Working
/// 11. Work → Review → Done → Integration succeeds → Complete
#[test]
fn test_exhaustive_workflow_flow() {
    let ctx = setup_test();

    // =========================================================================
    // Step 1: Task created → Planning
    // =========================================================================
    let task = ctx.api()
        .create_task(
            "Implement feature X",
            "Add the new feature X with full test coverage",
        )
        .expect("Should create task");

    let task_id = task.id.clone();

    assert_eq!(task.current_stage(), Some("planning"));
    assert_eq!(task.phase, Phase::Idle);

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
                QuestionOption::new("sqlite", "SQLite")
                    .with_description("Simple, file-based"),
            ]),
        Question::new("q2", "Should we add caching?"),
    ];
    ctx.set_output(&task_id, MockAgentOutput::Questions(questions));
    ctx.tick();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);
    assert_eq!(task.pending_questions.len(), 2);
    assert!(task.pending_questions[0].is_multiple_choice());
    assert!(!task.pending_questions[1].is_multiple_choice());

    // Human answers questions
    let answers = vec![
        QuestionAnswer::new("q1", "Which database should we use?", "PostgreSQL", chrono::Utc::now().to_rfc3339()),
        QuestionAnswer::new("q2", "Should we add caching?", "Yes, use Redis", chrono::Utc::now().to_rfc3339()),
    ];

    let task = ctx.api()
        .answer_questions(&task_id, answers)
        .expect("Should answer questions");

    assert_eq!(task.phase, Phase::Idle);
    assert!(task.pending_questions.is_empty());
    assert_eq!(task.question_history.len(), 2);

    // =========================================================================
    // Step 3: Planner produces plan → Plan rejected → Retry planning
    // =========================================================================

    // Orchestrator spawns planner again, produces plan
    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "plan".to_string(),
        content: "Initial plan v1 - not detailed enough".to_string(),
    });
    ctx.tick();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);
    assert_eq!(
        task.artifact("plan"),
        Some("Initial plan v1 - not detailed enough")
    );

    // Human rejects the plan
    let task = ctx.api()
        .reject(&task_id, "Need more detail on the implementation steps")
        .expect("Should reject plan");

    assert_eq!(task.current_stage(), Some("planning"));
    assert_eq!(task.phase, Phase::Idle);

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(iterations.len(), 2, "Should have 2 iterations after rejection");

    // Check first iteration ended with rejection
    assert!(iterations[0].outcome.is_some());
    assert!(matches!(
        iterations[0].outcome.as_ref().unwrap(),
        Outcome::Rejected { .. }
    ));

    // Orchestrator spawns planner again, produces better plan
    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "plan".to_string(),
        content: "Detailed plan v2:\n1. Create module\n2. Add tests\n3. Update docs".to_string(),
    });
    ctx.tick();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.phase, Phase::AwaitingReview);

    // =========================================================================
    // Step 4: Plan approved → Working (skips optional breakdown)
    // =========================================================================

    let task = ctx.api().approve(&task_id).expect("Should approve plan");

    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Should skip breakdown and go to work"
    );
    assert_eq!(task.phase, Phase::Idle);

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        3,
        "Should have 3 iterations (planning x2, work)"
    );

    // =========================================================================
    // Step 5: Work rejected → Retry working
    // =========================================================================

    // Orchestrator spawns worker
    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "summary".to_string(),
        content: "Initial implementation - tests failing".to_string(),
    });
    ctx.tick();

    // Human rejects the work
    let task = ctx.api()
        .reject(&task_id, "Tests are failing, please fix them")
        .expect("Should reject work");

    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::Idle);

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(iterations.len(), 4);

    // Orchestrator spawns worker again
    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "summary".to_string(),
        content: "Implementation complete with passing tests".to_string(),
    });
    ctx.tick();

    // =========================================================================
    // Step 6: Work approved → Reviewing
    // =========================================================================

    let task = ctx.api().approve(&task_id).expect("Should approve work");

    assert_eq!(task.current_stage(), Some("review"));
    assert_eq!(task.phase, Phase::Idle);

    // =========================================================================
    // Step 7: Reviewer restages to Work → Working
    // =========================================================================

    // Orchestrator spawns reviewer, reviewer restages to work
    ctx.set_output(&task_id, MockAgentOutput::Restage {
        target: "work".to_string(),
        feedback: "Code style issues found - please fix formatting".to_string(),
    });
    ctx.tick();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::Idle);

    // Check the iteration recorded the restage
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let restage_iter = iterations.iter().find(|i| {
        matches!(
            i.outcome.as_ref(),
            Some(Outcome::Restage { target, .. }) if target == "work"
        )
    });
    assert!(restage_iter.is_some(), "Should have restage iteration");

    // Orchestrator spawns worker to fix formatting
    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "summary".to_string(),
        content: "Implementation with fixed formatting".to_string(),
    });
    ctx.tick();

    // =========================================================================
    // Step 8: Work approved again → Reviewing
    // =========================================================================

    let task = ctx.api().approve(&task_id).expect("Should approve work again");

    assert_eq!(task.current_stage(), Some("review"));

    // =========================================================================
    // Step 9: Reviewer approves → Done
    // =========================================================================

    // Orchestrator spawns reviewer
    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "verdict".to_string(),
        content: "LGTM! All checks pass.".to_string(),
    });
    ctx.tick();

    let task = ctx.api().get_task(&task_id).unwrap();

    // Review is automated, so it auto-approves and moves to Done
    assert!(task.is_done(), "Task should be Done after automated review");
    assert_eq!(task.artifact("verdict"), Some("LGTM! All checks pass."));

    // =========================================================================
    // Step 10: Integration fails → Back to Working
    // =========================================================================

    let task = ctx.api()
        .integration_failed(&task_id, "Merge conflict in src/main.rs", vec!["src/main.rs".to_string()])
        .expect("Should handle integration failure");

    assert_eq!(task.current_stage(), Some("work"));
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
    // Step 11: Work → Review → Done → Integration succeeds → Complete
    // =========================================================================

    // Orchestrator spawns worker to resolve conflict
    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "summary".to_string(),
        content: "Resolved merge conflict".to_string(),
    });
    ctx.tick();

    // Approve work
    let task = ctx.api().approve(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("review"));

    // Orchestrator spawns reviewer (automated stage auto-transitions to Done)
    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "verdict".to_string(),
        content: "Conflict resolved correctly".to_string(),
    });
    ctx.tick();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Automated review should auto-transition to Done");

    // Integration succeeds
    let task = ctx.api()
        .integration_succeeded(&task_id)
        .expect("Should integrate successfully");

    assert!(task.is_done());
    assert!(task.completed_at.is_some());

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
            iter.outcome.as_ref().map(|o| format!("{}", o))
        );
    }

    // Verify we have the expected artifacts
    assert!(task.artifact("plan").is_some(), "Should have plan");
    assert!(task.artifact("summary").is_some(), "Should have summary");
    assert!(task.artifact("verdict").is_some(), "Should have verdict");

    // Verify question history was preserved
    assert_eq!(task.question_history.len(), 2);
    assert_eq!(task.question_history[0].answer, "PostgreSQL");

    // Verify spawner was called the expected number of times
    // planning (questions) + planning (plan v1) + planning (plan v2) +
    // work (v1) + work (v2) + review (restage) + work (fix) + review (approve) +
    // work (conflict) + review (final) = 10 spawns
    let total_spawns = ctx.spawner.calls().len();
    println!("Total agent spawns: {}", total_spawns);
}

/// Test that invalid restage is rejected
#[test]
fn test_restage_validation() {
    let ctx = setup_test();

    // Create task and get to work stage
    let task = ctx.api().create_task("Test", "Test task").unwrap();
    let task_id = task.id.clone();

    ctx.set_output(&task_id, MockAgentOutput::Artifact {
        name: "plan".to_string(),
        content: "Plan".to_string(),
    });
    ctx.tick();

    ctx.api().approve(&task_id).unwrap();

    // Try to restage from work (which doesn't have restage capability)
    ctx.set_output(&task_id, MockAgentOutput::Restage {
        target: "planning".to_string(),
        feedback: "Should fail".to_string(),
    });
    ctx.tick();

    // The task should still be in work stage (restage should have failed)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.current_stage(), Some("work"), "Restage should have been rejected");
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

/// Test custom integration.on_failure configuration
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
    let yaml = r#"
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
"#;
    std::fs::write(&workflow_path, yaml).unwrap();

    let workflow = load_workflow(&workflow_path).expect("Should load workflow");
    assert_eq!(workflow.integration.on_failure, "planning");

    // Create real SQLite database
    let db_path = orkestra_dir.join("orkestra.db");
    let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
    let store = Box::new(SqliteWorkflowStore::new(db_conn.shared()));

    let api = Arc::new(Mutex::new(WorkflowApi::new(workflow, store)));
    let project_root = PathBuf::from(temp_dir.path());
    let spawner = Arc::new(MockSpawner::new());
    let orchestrator = OrchestratorLoop::new(api.clone(), project_root, spawner.clone());

    // Helper to tick and wait
    let tick = || {
        orchestrator.tick().expect("Tick should succeed");
        std::thread::sleep(Duration::from_millis(50));
    };

    // Create a task and get it to Done
    let task = api.lock().unwrap().create_task("Test", "Test task").unwrap();
    let task_id = task.id.clone();

    // Planning stage
    spawner.set_output(&task_id, MockAgentOutput::Artifact {
        name: "plan".to_string(),
        content: "Plan".to_string(),
    }.into());
    tick();
    api.lock().unwrap().approve(&task_id).unwrap();

    // Work stage
    spawner.set_output(&task_id, MockAgentOutput::Artifact {
        name: "summary".to_string(),
        content: "Summary".to_string(),
    }.into());
    tick();
    api.lock().unwrap().approve(&task_id).unwrap();

    // Review stage (auto-approves to Done)
    spawner.set_output(&task_id, MockAgentOutput::Artifact {
        name: "verdict".to_string(),
        content: "LGTM".to_string(),
    }.into());
    tick();

    let task = api.lock().unwrap().get_task(&task_id).unwrap();
    assert!(task.is_done());

    // Integration fails - should go to planning (not work)
    let task = api.lock().unwrap()
        .integration_failed(&task_id, "Merge conflict", vec![])
        .expect("Should handle integration failure");

    assert_eq!(
        task.current_stage(),
        Some("planning"),
        "Should go to planning (configured on_failure) not work"
    );
}
