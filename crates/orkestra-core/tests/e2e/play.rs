//! E2E tests for `ork play` execution patterns.
//!
//! Verifies orchestrator-driven `auto_mode=true` execution: tasks progress through
//! all stages without human intervention. These tests exercise the specific behaviors
//! `ork play` depends on: auto-advancing artifacts, auto-answering questions, terminal
//! states, gate retry loops, and post-loop integration.

use std::time::Duration;

use orkestra_core::workflow::{
    config::{
        FlowConfig, FlowStageEntry, GateConfig, IntegrationConfig, StageCapabilities, StageConfig,
        WorkflowConfig,
    },
    create_pr_sync,
    domain::{IterationTrigger, Question},
    execution::SubtaskOutput,
    merge_task_sync,
    runtime::TaskState,
};

use crate::helpers::{disable_auto_merge, enable_auto_merge, workflows, MockAgentOutput, TestEnv};

// ============================================================================
// Tests
// ============================================================================

/// Happy path: task with `auto_mode=true` runs all stages to Done without
/// entering `AwaitingApproval` or requiring any human action.
#[test]
fn test_play_happy_path() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan").with_prompt("planner.md"),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx
        .api()
        .create_task_with_options("Implement feature", "Build it", None, true, None)
        .unwrap();
    let task_id = task.id.clone();

    // Pre-queue both stage outputs — MockAgentRunner consumes in FIFO order as agents spawn.
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "The implementation plan".into(),
            activity_log: None,
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Implementation complete".into(),
            activity_log: None,
        },
    );

    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_done(),
        Duration::from_secs(5),
        "task should reach Done with auto_mode=true",
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.auto_mode, "task should have auto_mode=true");
    assert!(
        task.artifact("plan").is_some(),
        "plan artifact should be stored"
    );
    assert!(
        task.artifact("summary").is_some(),
        "summary artifact should be stored"
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let stages: Vec<&str> = iterations.iter().map(|i| i.stage.as_str()).collect();
    assert!(
        stages.contains(&"planning"),
        "should have planning iteration"
    );
    assert!(stages.contains(&"work"), "should have work iteration");
    assert_eq!(
        iterations.len(),
        2,
        "should have exactly 2 iterations (no retries or approvals)"
    );
}

/// Breakdown produces subtasks, they execute in dependency order, and the parent
/// advances after all subtasks are archived.
#[test]
#[allow(clippy::too_many_lines)]
fn test_play_with_subtasks() {
    let workflow = enable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx
        .api()
        .create_task_with_options(
            "Build feature",
            "Complex task needing breakdown",
            None,
            true,
            None,
        )
        .unwrap();
    let task_id = task.id.clone();

    // Pre-queue parent outputs: planning → breakdown (with subtasks)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "The plan".into(),
            activity_log: None,
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Subtasks {
            content: "Technical breakdown".into(),
            subtasks: vec![
                SubtaskOutput {
                    title: "First subtask".into(),
                    description: "Do first".into(),
                    detailed_instructions: "Instructions 1".into(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Second subtask".into(),
                    description: "Do second".into(),
                    detailed_instructions: "Instructions 2".into(),
                    depends_on: vec![0],
                },
            ],
            activity_log: None,
        },
    );
    // Pre-queue parent post-subtask outputs (consumed after WaitingOnChildren resolves)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Parent work complete".into(),
            activity_log: None,
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "All good".into(),
            activity_log: None,
        },
    );

    // Tick until parent enters WaitingOnChildren (planning + breakdown complete)
    ctx.tick_until(
        || {
            ctx.api()
                .get_task(&task_id)
                .unwrap()
                .state
                .is_waiting_on_children()
        },
        Duration::from_secs(10),
        "parent should enter WaitingOnChildren after breakdown",
    );

    let subtasks = ctx.api().list_subtasks(&task_id).unwrap();
    assert_eq!(subtasks.len(), 2, "should have 2 subtasks");

    let first = subtasks
        .iter()
        .find(|s| s.depends_on.is_empty())
        .expect("should have a subtask with no dependencies");
    let second = subtasks
        .iter()
        .find(|s| !s.depends_on.is_empty())
        .expect("should have a subtask with dependencies");
    assert!(
        second.depends_on.contains(&first.id),
        "second subtask should depend on first"
    );

    // Queue work + review outputs for each subtask
    for subtask in &subtasks {
        ctx.set_output(
            &subtask.id,
            MockAgentOutput::Artifact {
                name: "summary".into(),
                content: format!("Work for {}", subtask.title),
                activity_log: None,
            },
        );
        ctx.set_output(
            &subtask.id,
            MockAgentOutput::Artifact {
                name: "verdict".into(),
                content: "Subtask done".into(),
                activity_log: None,
            },
        );
    }

    // Tick until parent reaches Done (subtasks execute → integrate → parent resumes)
    ctx.tick_until(
        || {
            let task = ctx.api().get_task(&task_id).unwrap();
            task.is_done() || task.is_archived()
        },
        Duration::from_secs(30),
        "parent should reach Done after all subtasks archived",
    );

    // All subtasks should be Archived (integrated into parent branch)
    for subtask in &subtasks {
        let st = ctx.api().get_task(&subtask.id).unwrap();
        assert!(
            st.is_archived(),
            "subtask '{}' should be Archived, got: {:?}",
            subtask.title,
            st.state
        );
    }
}

/// Questions are auto-answered when `auto_mode=true` — task never enters
/// `AwaitingQuestionAnswer`.
#[test]
fn test_play_questions_auto_answered() {
    let workflow = WorkflowConfig::new(vec![StageConfig::new("planning", "plan")
        .with_prompt("planner.md")
        .with_capabilities(StageCapabilities::with_questions())]);
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx
        .api()
        .create_task_with_options("Plan task", "Needs planning", None, true, None)
        .unwrap();
    let task_id = task.id.clone();

    // First run asks questions; second run (after auto-answer) produces the artifact.
    ctx.set_output(
        &task_id,
        MockAgentOutput::Questions(vec![Question::new("What approach should we take?")]),
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan after auto-answer".into(),
            activity_log: None,
        },
    );

    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_done(),
        Duration::from_secs(5),
        "task should reach Done after questions auto-answered",
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        !matches!(task.state, TaskState::AwaitingQuestionAnswer { .. }),
        "task should not be in AwaitingQuestionAnswer after auto-answer"
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let planning_iters: Vec<_> = iterations
        .iter()
        .filter(|i| i.stage == "planning")
        .collect();
    assert_eq!(
        planning_iters.len(),
        2,
        "planning should have 2 iterations (questions + retry after auto-answer)"
    );
    let auto_answered = planning_iters
        .iter()
        .any(|i| matches!(i.incoming_context, Some(IterationTrigger::Answers { .. })));
    assert!(
        auto_answered,
        "second planning iteration should have Answers trigger from auto-answer"
    );
}

/// Agent returns Blocked, task reaches terminal `Blocked` state.
#[test]
fn test_play_agent_blocked() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ]);
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx
        .api()
        .create_task_with_options("Blocked task", "Will block", None, true, None)
        .unwrap();
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Blocked {
            reason: "Cannot proceed: missing context".into(),
        },
    );

    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_blocked(),
        Duration::from_secs(5),
        "task should reach Blocked state",
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    if let TaskState::Blocked { reason, .. } = &task.state {
        assert!(
            reason.as_deref().unwrap_or("").contains("Cannot proceed"),
            "blocked reason should contain the original message, got: {reason:?}"
        );
    } else {
        panic!("Expected Blocked state, got: {:?}", task.state);
    }
}

/// Agent returns Failed, task reaches terminal `Failed` state.
#[test]
fn test_play_agent_failed() {
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ]);
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx
        .api()
        .create_task_with_options("Failed task", "Will fail", None, true, None)
        .unwrap();
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Failed {
            error: "Something broke: unrecoverable error".into(),
        },
    );

    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_failed(),
        Duration::from_secs(5),
        "task should reach Failed state",
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    if let TaskState::Failed { error, .. } = &task.state {
        assert!(
            error.as_deref().unwrap_or("").contains("Something broke"),
            "failed error should contain the original message, got: {error:?}"
        );
    } else {
        panic!("Expected Failed state, got: {:?}", task.state);
    }
}

/// Gate failure re-queues the agent with error feedback. On the next run the
/// gate passes, task auto-advances (`auto_mode=true`), and reaches Done.
#[test]
fn test_play_gate_failure_requeues_agent() {
    // Toggle gate: fails first time (creates marker), passes second time (removes marker).
    // Uses $ORKESTRA_TASK_ID in the marker path for isolation between parallel tests.
    let gate_command = concat!(
        "MARKER=/tmp/orkestra_play_gate_${ORKESTRA_TASK_ID}; ",
        "if [ -z \"$ORKESTRA_TASK_ID\" ]; then exit 1; fi; ",
        "if [ -f \"$MARKER\" ]; then rm \"$MARKER\"; exit 0; ",
        "else touch \"$MARKER\"; exit 1; fi",
    );

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::new(gate_command).with_timeout(10)),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .automated(),
    ])
    .with_integration(IntegrationConfig::new("work"));

    let ctx = TestEnv::with_git(&workflow, &["worker", "reviewer"]);

    let task = ctx
        .api()
        .create_task_with_options(
            "Gate test",
            "Test gate retry with auto_mode",
            None,
            true,
            None,
        )
        .unwrap();
    let task_id = task.id.clone();

    // Pre-queue all outputs up front:
    // 1. First work output (gate will fail → re-queued)
    // 2. Second work output (gate will pass → auto-advance to review)
    // 3. Review output (automated stage, auto-advances to Done)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Initial implementation".into(),
            activity_log: None,
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Fixed implementation after gate feedback".into(),
            activity_log: None,
        },
    );
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "Looks good".into(),
            activity_log: None,
        },
    );

    // Tick until gate fails and GateFailure iteration trigger is created
    ctx.tick_until(
        || {
            let iterations = ctx.api().get_iterations(&task_id).unwrap();
            iterations.iter().any(|i| {
                matches!(
                    i.incoming_context,
                    Some(IterationTrigger::GateFailure { .. })
                )
            })
        },
        Duration::from_secs(10),
        "gate should fail and re-queue agent with GateFailure trigger",
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "task should be Queued after gate failure, got: {:?}",
        task.state
    );
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "task should still be in work stage after gate failure"
    );

    // Tick until Done: second work output → gate passes → auto-advance → review → Done
    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_done(),
        Duration::from_secs(10),
        "task should reach Done after gate passes on retry",
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert!(
        iterations.iter().any(|i| matches!(
            i.incoming_context,
            Some(IterationTrigger::GateFailure { .. })
        )),
        "should have GateFailure iteration trigger in history"
    );
    assert!(
        iterations.iter().any(|i| i.stage == "review"),
        "should have review iteration after gate passes"
    );
}

/// `merge_task_sync` works after the `ork play` orchestrator loop completes.
///
/// Verifies that `merge_task_sync` (the integration step `ork play` calls
/// after the tick loop) correctly transitions a Done task to Archived.
#[test]
fn test_play_integration_after_done() {
    let workflow = disable_auto_merge(WorkflowConfig::new(vec![StageConfig::new(
        "work", "summary",
    )
    .with_prompt("worker.md")]));
    let ctx = TestEnv::with_mock_git(&workflow, &["worker"]);

    let task = ctx
        .api()
        .create_task_with_options("Integration test", "Test post-loop merge", None, true, None)
        .unwrap();
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work complete".into(),
            activity_log: None,
        },
    );

    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_done(),
        Duration::from_secs(5),
        "task should reach Done with auto_mode=true",
    );

    // auto_merge is disabled — task stays Done (not auto-integrated)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "task should be Done before merge");

    // Manually trigger merge (as `ork play` does after the orchestrator loop exits)
    merge_task_sync(ctx.api_arc(), &task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "task should be Archived after merge_task_sync, got: {:?}",
        task.state
    );
}

/// `create_pr_sync` works after the `ork play` orchestrator loop completes.
///
/// Verifies that when `ork play` runs without `--no-pr`, it calls `create_pr_sync`
/// (not `merge_task_sync`) — the PR is the integration mechanism, not a direct merge.
/// The task should remain Done with `pr_url` set after PR creation.
#[test]
fn test_play_pr_creation_after_done() {
    let workflow = disable_auto_merge(WorkflowConfig::new(vec![StageConfig::new(
        "work", "summary",
    )
    .with_prompt("worker.md")]));
    let ctx = TestEnv::with_mock_git(&workflow, &["worker"]);

    let task = ctx
        .api()
        .create_task_with_options("PR test", "Test PR creation path", None, true, None)
        .unwrap();
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work complete".into(),
            activity_log: None,
        },
    );

    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_done(),
        Duration::from_secs(5),
        "task should reach Done with auto_mode=true",
    );

    // Configure mock PR service to succeed
    ctx.pr_service()
        .set_next_result(Ok("https://github.com/test/repo/pull/42".to_string()));

    // Call create_pr_sync — this is what `ork play` does when `!no_pr`
    let task = create_pr_sync(ctx.api_arc(), &task_id).unwrap();

    // Task should be Done with pr_url set (not Archived — PR is delivered on the branch)
    assert!(
        matches!(task.state, TaskState::Done),
        "task should still be Done after PR creation, got: {:?}",
        task.state
    );
    assert_eq!(
        task.pr_url,
        Some("https://github.com/test/repo/pull/42".to_string()),
        "PR URL should be stored on the task"
    );
}

/// Tasks created with `--flow quick` only run the flow's stages.
///
/// Verifies that the `flow` parameter is respected: a task with `flow=Some("quick")`
/// skips the `planning` stage and only runs `work`, reaching Done with 1 iteration.
#[test]
fn test_play_with_flow() {
    // Two-stage workflow: planning → work
    let base_workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan").with_prompt("planner.md"),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ]);

    // Add a "quick" flow that only includes the work stage
    let mut flows = indexmap::IndexMap::new();
    flows.insert(
        "quick".to_string(),
        FlowConfig {
            description: "Skip planning, go straight to work".to_string(),
            icon: None,
            stages: vec![FlowStageEntry {
                stage_name: "work".to_string(),
                overrides: None,
            }],
            integration: None,
        },
    );
    let workflow = base_workflow.with_flows(flows);

    let ctx = TestEnv::with_workflow(workflow);

    // Create task with flow="quick" — should skip planning
    let task = ctx
        .api()
        .create_task_with_options(
            "Quick task",
            "No planning needed",
            None,
            true,
            Some("quick"),
        )
        .unwrap();
    let task_id = task.id.clone();

    // Queue only the work output (planning should be skipped)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done directly".into(),
            activity_log: None,
        },
    );

    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_done(),
        Duration::from_secs(5),
        "task should reach Done running only work stage",
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(
        iterations.len(),
        1,
        "should have exactly 1 iteration (work only, no planning), got: {iterations:?}"
    );
    assert_eq!(
        iterations[0].stage, "work",
        "the single iteration should be for the work stage"
    );
}

/// When `auto_merge: true`, the orchestrator integrates the task during the tick loop.
///
/// Verifies that after the loop exits on `TaskState::Archived`, the task was integrated
/// by the orchestrator — `ork play` should skip post-loop merge/PR in this case.
#[test]
fn test_play_auto_merge_completes_to_archived() {
    let workflow = enable_auto_merge(WorkflowConfig::new(vec![StageConfig::new(
        "work", "summary",
    )
    .with_prompt("worker.md")]));
    let ctx = TestEnv::with_mock_git(&workflow, &["worker"]);

    let task = ctx
        .api()
        .create_task_with_options("Auto merge task", "Test auto_merge path", None, true, None)
        .unwrap();
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work complete".into(),
            activity_log: None,
        },
    );

    // Tick until Archived — the orchestrator auto-merges and archives without human action
    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_archived(),
        Duration::from_secs(10),
        "task should reach Archived via auto_merge without manual merge",
    );

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_archived(),
        "task should be Archived (auto_merge handled integration), got: {:?}",
        task.state
    );
    // task.is_done() is false — this is the state `ork play` checks to skip post-loop integration
    assert!(
        !task.is_done(),
        "task should NOT be Done when auto_merge archived it (would trigger double-merge)"
    );
}

/// When integration is skipped (`--no-integrate`), the task stays Done after the loop.
///
/// Verifies the orchestrator leaves the task in Done state when `auto_merge` is disabled
/// and no manual integration is triggered — this is the state `ork play --no-integrate`
/// relies on to skip post-loop merge/PR.
#[test]
fn test_play_no_integrate_stays_done() {
    let workflow = disable_auto_merge(WorkflowConfig::new(vec![StageConfig::new(
        "work", "summary",
    )
    .with_prompt("worker.md")]));
    let ctx = TestEnv::with_workflow(workflow);

    let task = ctx
        .api()
        .create_task_with_options(
            "No-integrate task",
            "Test no-integrate path",
            None,
            true,
            None,
        )
        .unwrap();
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work complete".into(),
            activity_log: None,
        },
    );

    ctx.tick_until(
        || ctx.api().get_task(&task_id).unwrap().is_done(),
        Duration::from_secs(5),
        "task should reach Done with auto_mode=true",
    );

    // No merge triggered — task should stay Done (not Archived)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_done(),
        "task should stay Done when integration is skipped, got: {:?}",
        task.state
    );
    assert!(
        !task.is_archived(),
        "task should NOT be Archived when --no-integrate is used"
    );
}
