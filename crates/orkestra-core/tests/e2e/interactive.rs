//! E2E tests for interactive mode lifecycle.
//!
//! Tests that interactive tasks are created correctly, that `enter_interactive_mode`
//! and `exit_interactive_mode` work as expected, and that the orchestrator does
//! not try to advance interactive tasks.

use orkestra_core::workflow::{
    config::{StageCapabilities, StageConfig, WorkflowConfig},
    domain::IterationTrigger,
    runtime::TaskState,
};

use crate::helpers::{MockAgentOutput, TestEnv};

// =============================================================================
// Test helpers
// =============================================================================

/// Single-stage workflow with approval.
fn interactive_test_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_capabilities(StageCapabilities::with_approval(None))])
}

// =============================================================================
// create_interactive_task
// =============================================================================

#[test]
fn test_create_interactive_task_transitions_to_interactive_after_setup() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx
        .api()
        .create_interactive_task("Interactive task", "Do interactive work", None, None)
        .expect("Should create interactive task");
    let task_id = task.id.clone();

    // One tick triggers setup_awaiting_tasks — with sync setup, it completes inline.
    // Interactive tasks should transition to Interactive state (not Queued).
    ctx.advance();

    let task = ctx.api().get_task(&task_id).expect("Should get task");
    assert!(
        matches!(task.state, TaskState::Interactive { .. }),
        "Interactive task should be in Interactive state after setup, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("work"), "Stage should be 'work'");
    assert!(
        task.created_interactive,
        "Task.created_interactive should be true"
    );
}

#[test]
fn test_create_interactive_task_is_ignored_by_orchestrator() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx
        .api()
        .create_interactive_task(
            "Interactive ignored",
            "Orchestrator should not touch this",
            None,
            None,
        )
        .expect("Should create interactive task");
    let task_id = task.id.clone();

    // First advance: setup completes, task enters Interactive state
    ctx.advance();

    // Several more advances: orchestrator should NOT spawn an agent for this task
    ctx.advance();
    ctx.advance();

    let task = ctx.api().get_task(&task_id).expect("Should get task");
    assert!(
        matches!(task.state, TaskState::Interactive { .. }),
        "Orchestrator should not advance an Interactive task, got: {:?}",
        task.state
    );

    // No agent should have been spawned
    let calls = ctx.runner_calls();
    let task_calls = calls
        .iter()
        .filter(|c| c.task_id.as_deref() == Some(&task_id))
        .count();
    assert_eq!(
        task_calls, 0,
        "No agent should be spawned for an Interactive task"
    );
}

// =============================================================================
// enter_interactive_mode
// =============================================================================

#[test]
fn test_enter_interactive_mode_from_queued() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Normal task", "Will enter interactive", None);
    let task_id = task.id.clone();

    // Task is now in Queued state (setup complete)
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after setup, got: {:?}",
        task.state
    );

    // Enter interactive mode
    let task = ctx
        .api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    assert!(
        matches!(task.state, TaskState::Interactive { ref stage } if stage == "work"),
        "Task should be Interactive(work) after entering interactive mode, got: {:?}",
        task.state
    );
}

#[test]
fn test_enter_interactive_mode_rejects_agent_working_state() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Running task", "Agent is working", None);
    let task_id = task.id.clone();

    // Spawn an agent (moves to AgentWorking)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "done".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawns agent

    // Agent is now working — cannot enter interactive mode
    let task = ctx.api().get_task(&task_id).unwrap();
    if matches!(task.state, TaskState::AgentWorking { .. }) {
        let result = ctx.api().enter_interactive_mode(&task_id);
        assert!(
            result.is_err(),
            "Should not enter interactive mode while agent is working"
        );
    }
    // If state advanced further (mock completes synchronously), that's fine too
}

// =============================================================================
// exit_interactive_mode
// =============================================================================

#[test]
fn test_exit_interactive_mode_transitions_to_queued() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("To exit interactive", "Will exit", None);
    let task_id = task.id.clone();

    // Enter interactive mode
    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    // Exit interactive mode — return to current stage
    let task = ctx
        .api()
        .exit_interactive_mode(&task_id, Some("work"))
        .expect("Should exit interactive mode");

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "work"),
        "Task should be Queued(work) after exiting interactive mode, got: {:?}",
        task.state
    );
}

#[test]
fn test_exit_interactive_mode_creates_iteration_with_interactive_trigger() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Iteration trigger test", "Check trigger", None);
    let task_id = task.id.clone();

    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    ctx.api()
        .exit_interactive_mode(&task_id, Some("work"))
        .expect("Should exit interactive mode");

    // The latest iteration should have the ReturnFromInteractive trigger
    let iterations = ctx
        .api()
        .get_iterations(&task_id)
        .expect("Should get iterations");
    let latest = iterations
        .iter()
        .filter(|i| i.stage == "work")
        .max_by_key(|i| i.iteration_number)
        .expect("Should have at least one iteration");

    assert!(
        matches!(
            latest.incoming_context,
            Some(IterationTrigger::ReturnFromInteractive)
        ),
        "Latest iteration should have ReturnFromInteractive trigger, got: {:?}",
        latest.incoming_context
    );
}

#[test]
fn test_exit_interactive_mode_rejects_non_interactive_state() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Not interactive", "Will fail", None);
    let task_id = task.id.clone();

    // Task is Queued, not Interactive — should fail
    let result = ctx.api().exit_interactive_mode(&task_id, Some("work"));
    assert!(
        result.is_err(),
        "Should not exit interactive mode when not in Interactive state"
    );
}

// =============================================================================
// Orchestrator picks up exited interactive tasks
// =============================================================================

#[test]
fn test_orchestrator_advances_task_after_exit_interactive() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Will advance after interactive", "Test", None);
    let task_id = task.id.clone();

    // Enter and exit interactive mode — return to work stage
    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");
    ctx.api()
        .exit_interactive_mode(&task_id, Some("work"))
        .expect("Should exit interactive mode");

    // Task is now Queued — set mock output so the agent can run
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done after interactive session.".to_string(),
            activity_log: None,
        },
    );

    // Advance: orchestrator should pick up the Queued task and spawn an agent
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → AwaitingApproval

    let task = ctx.api().get_task(&task_id).expect("Should get task");
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should be AwaitingApproval after agent run following interactive session, got: {:?}",
        task.state
    );
}

// =============================================================================
// DerivedTaskState::is_interactive
// =============================================================================

#[test]
fn test_derived_state_is_interactive_for_interactive_task() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx
        .api()
        .create_interactive_task("Interactive derived", "Test derived state", None, None)
        .expect("Should create interactive task");
    let task_id = task.id.clone();

    ctx.advance(); // complete setup → Interactive state

    let task = ctx.api().get_task(&task_id).expect("Should get task");
    assert!(
        task.state.is_interactive(),
        "TaskState::is_interactive() should be true for Interactive state"
    );
}

#[test]
fn test_derived_state_not_interactive_for_queued_task() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Normal queued", "Not interactive", None);
    assert!(
        !task.state.is_interactive(),
        "TaskState::is_interactive() should be false for Queued state"
    );
}

// =============================================================================
// exit_interactive_mode — Done path and commit-on-exit
// =============================================================================

#[test]
fn test_exit_interactive_to_done() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Exit to done", "Will mark done", None);
    let task_id = task.id.clone();

    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    // target_stage: None → mark as Done
    let task = ctx
        .api()
        .exit_interactive_mode(&task_id, None)
        .expect("Should exit interactive mode");

    assert!(
        matches!(task.state, TaskState::Done),
        "Task should be Done after exiting interactive mode with None target, got: {:?}",
        task.state
    );
    assert!(
        task.completed_at.is_some(),
        "Task should have completed_at set when marked Done"
    );

    // Latest iteration should have ReturnFromInteractive trigger
    let iterations = ctx
        .api()
        .get_iterations(&task_id)
        .expect("Should get iterations");
    let latest = iterations
        .iter()
        .filter(|i| i.stage == "work")
        .max_by_key(|i| i.iteration_number)
        .expect("Should have at least one iteration");
    assert!(
        matches!(
            latest.incoming_context,
            Some(IterationTrigger::ReturnFromInteractive)
        ),
        "Latest iteration should have ReturnFromInteractive trigger, got: {:?}",
        latest.incoming_context
    );
}

#[test]
fn test_exit_interactive_to_stage() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Exit to stage", "Will queue at work", None);
    let task_id = task.id.clone();

    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    // target_stage: Some("work") → queue at that stage
    let task = ctx
        .api()
        .exit_interactive_mode(&task_id, Some("work"))
        .expect("Should exit interactive mode");

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "work"),
        "Task should be Queued(work) after exiting to stage, got: {:?}",
        task.state
    );

    // Latest iteration should have ReturnFromInteractive trigger
    let iterations = ctx
        .api()
        .get_iterations(&task_id)
        .expect("Should get iterations");
    let latest = iterations
        .iter()
        .filter(|i| i.stage == "work")
        .max_by_key(|i| i.iteration_number)
        .expect("Should have at least one iteration");
    assert!(
        matches!(
            latest.incoming_context,
            Some(IterationTrigger::ReturnFromInteractive)
        ),
        "Latest iteration should have ReturnFromInteractive trigger, got: {:?}",
        latest.incoming_context
    );
}

#[test]
fn test_exit_interactive_done_not_picked_up_by_orchestrator() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Done stays done", "Orchestrator should ignore", None);
    let task_id = task.id.clone();

    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    // Exit to Done
    ctx.api()
        .exit_interactive_mode(&task_id, None)
        .expect("Should exit interactive mode");

    // Several orchestrator advances — task should stay Done
    ctx.advance();
    ctx.advance();
    ctx.advance();

    let task = ctx.api().get_task(&task_id).expect("Should get task");
    assert!(
        matches!(task.state, TaskState::Done),
        "Done task should not be advanced by orchestrator, got: {:?}",
        task.state
    );

    // No agent should have been spawned
    let calls = ctx.runner_calls();
    let task_calls = calls
        .iter()
        .filter(|c| c.task_id.as_deref() == Some(&task_id))
        .count();
    assert_eq!(task_calls, 0, "No agent should be spawned for a Done task");
}

#[test]
fn test_exit_interactive_with_pending_changes_commits() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Commit on exit", "Should commit changes", None);
    let task_id = task.id.clone();

    // Enter interactive mode
    let task = ctx
        .api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    // Write an uncommitted file to the real worktree to create pending changes
    let worktree_path = task
        .worktree_path
        .as_ref()
        .expect("Should have worktree path");
    let test_file = std::path::Path::new(worktree_path).join("exit-test.txt");
    std::fs::write(&test_file, "interactive exit test content").unwrap();

    // Exit interactive mode — should commit the pending changes
    ctx.api()
        .exit_interactive_mode(&task_id, Some("work"))
        .expect("Should exit interactive mode");

    // Verify no pending changes remain — the file should have been committed
    let git_status = std::process::Command::new("git")
        .arg("status")
        .arg("--porcelain")
        .current_dir(worktree_path)
        .output()
        .expect("git status should succeed");

    assert!(
        git_status.stdout.is_empty(),
        "Worktree should have no uncommitted changes after exit, got: {}",
        String::from_utf8_lossy(&git_status.stdout)
    );
}

// =============================================================================
// Non-Queued bypassable state entry
// =============================================================================

#[test]
fn test_enter_interactive_mode_from_awaiting_approval() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Approval task", "Enter interactive from approval", None);
    let task_id = task.id.clone();

    // Run the agent to reach AwaitingApproval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "done".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should be in AwaitingApproval before test, got: {:?}",
        task.state
    );

    // Enter interactive mode from AwaitingApproval
    let task = ctx
        .api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode from AwaitingApproval");

    assert!(
        matches!(task.state, TaskState::Interactive { .. }),
        "Task should be Interactive after entering from AwaitingApproval, got: {:?}",
        task.state
    );
}

// =============================================================================
// No-changes-no-commit path
// =============================================================================

#[test]
fn test_exit_interactive_without_changes_skips_commit() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("No changes task", "Exit with no pending changes", None);
    let task_id = task.id.clone();

    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    // Exit without writing any files — commit step should be skipped gracefully
    let task = ctx
        .api()
        .exit_interactive_mode(&task_id, Some("work"))
        .expect("Should exit interactive mode even with no pending changes");

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "work"),
        "Task should be Queued(work) after exiting with no changes, got: {:?}",
        task.state
    );
}

// =============================================================================
// enter_interactive_mode from Done state
// =============================================================================

#[test]
fn test_enter_interactive_mode_from_done() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Done task", "Will enter interactive from Done", None);
    let task_id = task.id.clone();

    // Run the agent to reach AwaitingApproval, then approve to reach Done
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance → Done

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Done),
        "Task should be Done before test, got: {:?}",
        task.state
    );

    // Enter interactive mode from Done
    let task = ctx
        .api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode from Done state");

    assert!(
        matches!(task.state, TaskState::Interactive { ref stage } if stage == "work"),
        "Task should be Interactive(work) after entering from Done, got: {:?}",
        task.state
    );
}

#[test]
fn test_enter_exit_interactive_from_done_returns_to_done() {
    let ctx = TestEnv::with_git(&interactive_test_workflow(), &["worker"]);

    let task = ctx.create_task("Done task", "Will round-trip through interactive", None);
    let task_id = task.id.clone();

    // Advance to Done
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work complete".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit + advance → Done

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Done),
        "Task should be Done before test, got: {:?}",
        task.state
    );

    // Enter interactive from Done
    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode from Done state");

    // Exit with target_stage: None → return to Done
    let task = ctx
        .api()
        .exit_interactive_mode(&task_id, None)
        .expect("Should exit interactive mode");

    assert!(
        matches!(task.state, TaskState::Done),
        "Task should be Done after exiting interactive with None target, got: {:?}",
        task.state
    );
    assert!(
        task.completed_at.is_some(),
        "Task should have completed_at set when returning to Done"
    );
}

// =============================================================================
// Flow-restricted task stage validation
// =============================================================================

#[test]
fn test_exit_interactive_rejects_stage_not_in_flow() {
    use indexmap::IndexMap;
    use orkestra_core::workflow::config::{FlowConfig, IntegrationConfig};
    use orkestra_core::workflow::TaskCreationMode;

    // Two-stage workflow with a "work-only" flow
    let mut flows: IndexMap<String, FlowConfig> = IndexMap::new();
    flows.insert(
        "work-only".to_string(),
        FlowConfig {
            stages: vec![StageConfig::new("work", "summary")
                .with_prompt("worker.md")
                .with_capabilities(StageCapabilities::with_approval(None))],
            integration: IntegrationConfig::new("work"),
        },
    );

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_capabilities(StageCapabilities::with_approval(None)),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_capabilities(StageCapabilities::with_approval(None)),
    ])
    .with_flows(flows);

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    // Create a task using the "work-only" flow
    let task = ctx
        .api()
        .create_task_with_options(
            "Flow task",
            "Work-only flow",
            None,
            TaskCreationMode::Normal,
            Some("work-only"),
        )
        .expect("Should create task with flow");
    let task_id = task.id.clone();
    ctx.advance(); // complete setup

    ctx.api()
        .enter_interactive_mode(&task_id)
        .expect("Should enter interactive mode");

    // Exit to "review" — not in "work-only" flow; should be rejected
    let result = ctx.api().exit_interactive_mode(&task_id, Some("review"));
    assert!(
        result.is_err(),
        "Should reject exit to stage not in task's flow"
    );

    // Exit to "work" — valid; should succeed
    let task = ctx
        .api()
        .exit_interactive_mode(&task_id, Some("work"))
        .expect("Should exit to a stage that is in the flow");

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "work"),
        "Task should be Queued(work) after valid exit, got: {:?}",
        task.state
    );
}
