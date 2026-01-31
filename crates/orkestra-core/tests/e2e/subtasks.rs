//! End-to-end tests for the subtask system.
//!
//! Tests the full lifecycle: breakdown → subtask creation → dependency-aware
//! orchestration → parent completion detection.

use orkestra_core::workflow::execution::SubtaskOutput;

use super::helpers::{workflows, MockAgentOutput, TestEnv};

// =============================================================================
// Subtask Creation on Breakdown Approval
// =============================================================================

#[test]
fn test_breakdown_approval_creates_subtasks() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create parent task
    let parent = env.create_task("Implement feature", "Build a new feature", None);
    assert_eq!(parent.current_stage(), Some("planning"));

    // Planning stage: produce a plan
    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "The implementation plan".into(),
        },
    );
    env.tick_until_settled();

    // Approve the plan
    let parent = env.api().approve(&parent.id).unwrap();
    assert_eq!(parent.current_stage(), Some("breakdown"));

    // Breakdown stage: produce subtasks
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            subtasks: vec![
                SubtaskOutput {
                    title: "Setup database".into(),
                    description: "Create schema and migrations".into(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Build API".into(),
                    description: "Create REST endpoints".into(),
                    depends_on: vec![0],
                },
                SubtaskOutput {
                    title: "Build UI".into(),
                    description: "Create frontend components".into(),
                    depends_on: vec![0],
                },
            ],
            skip_reason: None,
        },
    );
    env.tick_until_settled();

    // Parent should be awaiting review with breakdown artifact
    let parent = env.api().get_task(&parent.id).unwrap();
    assert!(parent.needs_review(), "Parent should need review");
    assert!(parent.artifact("breakdown").is_some());

    // Approve the breakdown - this should create subtasks
    let parent = env.api().approve(&parent.id).unwrap();
    assert!(
        parent.status.is_waiting_on_children(),
        "Parent should be WaitingOnChildren, got: {:?}",
        parent.status
    );

    // Verify subtasks were created
    let subtasks = env.api().list_subtasks(&parent.id).unwrap();
    assert_eq!(subtasks.len(), 3, "Should have 3 subtasks");

    // Check subtask properties (order may vary since created_at is identical)
    let mut titles: Vec<&str> = subtasks.iter().map(|s| s.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(titles, vec!["Build API", "Build UI", "Setup database"]);

    // Check flow assignment
    for subtask in &subtasks {
        assert_eq!(subtask.flow, Some("subtask".to_string()));
        assert_eq!(subtask.parent_id, Some(parent.id.clone()));
    }

    // Check first stage is "work" (first stage in "subtask" flow)
    for subtask in &subtasks {
        assert_eq!(subtask.current_stage(), Some("work"));
    }

    // Check dependencies were mapped correctly (find by title since order is nondeterministic)
    let db_setup = subtasks
        .iter()
        .find(|s| s.title == "Setup database")
        .unwrap();
    let build_api = subtasks.iter().find(|s| s.title == "Build API").unwrap();
    let build_ui = subtasks.iter().find(|s| s.title == "Build UI").unwrap();
    assert!(db_setup.depends_on.is_empty());
    assert_eq!(build_api.depends_on, vec![db_setup.id.clone()]);
    assert_eq!(build_ui.depends_on, vec![db_setup.id.clone()]);

    // Subtasks should inherit parent's plan artifact
    for subtask in &subtasks {
        assert!(
            subtask.artifact("plan").is_some(),
            "Subtask should inherit plan artifact"
        );
    }
}

// =============================================================================
// Dependency-Aware Orchestration
// =============================================================================

#[test]
fn test_dependency_aware_orchestration() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Setup: Create parent and subtasks
    let parent = env.create_task("Feature", "Build it", None);

    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan".into(),
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            subtasks: vec![
                SubtaskOutput {
                    title: "First".into(),
                    description: "Independent task".into(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Second".into(),
                    description: "Depends on first".into(),
                    depends_on: vec![0],
                },
            ],
            skip_reason: None,
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    let subtasks = env.api().list_subtasks(&parent.id).unwrap();
    let first_id = subtasks[0].id.clone();
    let second_id = subtasks[1].id.clone();

    // Wait for subtask setup to complete
    for _ in 0..100 {
        std::thread::sleep(std::time::Duration::from_millis(20));
        let first = env.api().get_task(&first_id).unwrap();
        let second = env.api().get_task(&second_id).unwrap();
        if first.phase != orkestra_core::workflow::runtime::Phase::SettingUp
            && second.phase != orkestra_core::workflow::runtime::Phase::SettingUp
        {
            break;
        }
    }

    // Only the first subtask (no deps) should be eligible for agents
    let eligible = env.api().get_tasks_needing_agents().unwrap();
    let eligible_ids: Vec<&str> = eligible.iter().map(|t| t.id.as_str()).collect();
    assert!(
        eligible_ids.contains(&first_id.as_str()),
        "First subtask (no deps) should be eligible"
    );
    assert!(
        !eligible_ids.contains(&second_id.as_str()),
        "Second subtask (has deps) should NOT be eligible"
    );

    // Complete the first subtask through its full flow (work → review(automated) → Done)
    // Step 1: Work stage output
    env.set_output(
        &first_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Done".into(),
        },
    );
    env.tick_until_settled();

    // Work is not automated, so subtask should be awaiting review
    let first = env.api().get_task(&first_id).unwrap();
    assert_eq!(
        first.current_stage(),
        Some("work"),
        "First subtask should be in work stage awaiting review, got: {:?}",
        first.status
    );

    // Step 2: Approve work stage → advances to review stage
    let _ = env.api().approve(&first_id).unwrap();

    // Step 3: Review stage runs (automated) → set output for the reviewer.
    // Also pre-set the second subtask's work output because once the first subtask
    // completes, the orchestrator will immediately try to spawn the second subtask's
    // work agent in the same tick loop.
    env.set_output(
        &first_id,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "Looks good".into(),
        },
    );
    env.set_output(
        &second_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Second task done".into(),
        },
    );
    env.tick_until_settled();

    // Review is automated, so first subtask should auto-advance to Done
    let first = env.api().get_task(&first_id).unwrap();
    assert!(
        first.is_done(),
        "First subtask should be Done after review, got: {:?}",
        first.status
    );

    // Second subtask should now be eligible or already working (dependency satisfied)
    // It may have already been picked up by the orchestrator during tick_until_settled.
    let second = env.api().get_task(&second_id).unwrap();
    assert!(
        second.status.is_active(),
        "Second subtask should be active (eligible or already started), got: {:?}",
        second.status
    );
}

// =============================================================================
// Parent Completion Detection
// =============================================================================

#[test]
fn test_parent_advances_when_all_subtasks_done() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Setup: Create parent and subtasks
    let parent = env.create_task("Feature", "Build it", None);

    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan".into(),
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            subtasks: vec![
                SubtaskOutput {
                    title: "First".into(),
                    description: "Task 1".into(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Second".into(),
                    description: "Task 2".into(),
                    depends_on: vec![],
                },
            ],
            skip_reason: None,
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    let subtasks = env.api().list_subtasks(&parent.id).unwrap();
    let first_id = subtasks[0].id.clone();
    let second_id = subtasks[1].id.clone();

    // Wait for setup
    for _ in 0..100 {
        std::thread::sleep(std::time::Duration::from_millis(20));
        let first = env.api().get_task(&first_id).unwrap();
        let second = env.api().get_task(&second_id).unwrap();
        if first.phase != orkestra_core::workflow::runtime::Phase::SettingUp
            && second.phase != orkestra_core::workflow::runtime::Phase::SettingUp
        {
            break;
        }
    }

    // Both subtasks have no deps, so both may be spawned simultaneously.
    // Set outputs for both work stages before ticking.
    env.set_output(
        &first_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Done 1".into(),
        },
    );
    env.set_output(
        &second_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Done 2".into(),
        },
    );
    env.tick_until_settled();

    // Approve both work stages (work is not automated)
    let _ = env.api().approve(&first_id).unwrap();
    let _ = env.api().approve(&second_id).unwrap();

    // Set outputs for both review stages (review is automated, will auto-advance)
    env.set_output(
        &first_id,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "LGTM 1".into(),
        },
    );
    env.set_output(
        &second_id,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "LGTM 2".into(),
        },
    );
    env.tick_until_settled();

    // Both subtasks should be Done
    let first = env.api().get_task(&first_id).unwrap();
    let second = env.api().get_task(&second_id).unwrap();
    assert!(
        first.is_done(),
        "First subtask should be Done, got: {:?}",
        first.status
    );
    assert!(
        second.is_done(),
        "Second subtask should be Done, got: {:?}",
        second.status
    );

    // Tick to trigger parent completion check
    env.tick();

    // Parent should have advanced to the next stage after breakdown (work)
    let parent = env.api().get_task(&parent.id).unwrap();
    assert_eq!(
        parent.current_stage(),
        Some("work"),
        "Parent should advance to 'work' stage after all subtasks complete. Status: {:?}",
        parent.status
    );
}

// =============================================================================
// Diamond Dependency Pattern (Fan-Out / Fan-In)
// =============================================================================

#[test]
#[allow(clippy::too_many_lines)]
fn test_diamond_dependency_orchestration() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Setup: Create parent and get through planning + breakdown
    let parent = env.create_task("Diamond feature", "Build with diamond deps", None);

    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan".into(),
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    // Breakdown: diamond pattern A → B,C → D
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            subtasks: vec![
                SubtaskOutput {
                    title: "Node A".into(),
                    description: "Root node, no deps".into(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Node B".into(),
                    description: "Depends on A".into(),
                    depends_on: vec![0],
                },
                SubtaskOutput {
                    title: "Node C".into(),
                    description: "Depends on A".into(),
                    depends_on: vec![0],
                },
                SubtaskOutput {
                    title: "Node D".into(),
                    description: "Depends on B and C (fan-in)".into(),
                    depends_on: vec![1, 2],
                },
            ],
            skip_reason: None,
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    // Find subtasks by title (order is nondeterministic)
    let subtasks = env.api().list_subtasks(&parent.id).unwrap();
    assert_eq!(subtasks.len(), 4, "Should have 4 subtasks");

    let node_a = subtasks.iter().find(|s| s.title == "Node A").unwrap();
    let node_b = subtasks.iter().find(|s| s.title == "Node B").unwrap();
    let node_c = subtasks.iter().find(|s| s.title == "Node C").unwrap();
    let node_d = subtasks.iter().find(|s| s.title == "Node D").unwrap();

    let id_a = node_a.id.clone();
    let id_b = node_b.id.clone();
    let id_c = node_c.id.clone();
    let id_d = node_d.id.clone();

    // Verify dependency structure
    assert!(node_a.depends_on.is_empty(), "A should have no deps");
    assert_eq!(node_b.depends_on, vec![id_a.clone()], "B depends on A");
    assert_eq!(node_c.depends_on, vec![id_a.clone()], "C depends on A");
    assert!(node_d.depends_on.contains(&id_b), "D depends on B");
    assert!(node_d.depends_on.contains(&id_c), "D depends on C");
    assert_eq!(node_d.depends_on.len(), 2, "D has exactly 2 deps");

    // Wait for subtask setup to complete
    for _ in 0..100 {
        std::thread::sleep(std::time::Duration::from_millis(20));
        let tasks: Vec<_> = [&id_a, &id_b, &id_c, &id_d]
            .iter()
            .map(|id| env.api().get_task(id).unwrap())
            .collect();
        if tasks
            .iter()
            .all(|t| t.phase != orkestra_core::workflow::runtime::Phase::SettingUp)
        {
            break;
        }
    }

    // --- Phase 1: Only A should be eligible ---
    let eligible = env.api().get_tasks_needing_agents().unwrap();
    let eligible_ids: Vec<&str> = eligible.iter().map(|t| t.id.as_str()).collect();
    assert!(
        eligible_ids.contains(&id_a.as_str()),
        "A should be eligible"
    );
    assert!(
        !eligible_ids.contains(&id_b.as_str()),
        "B should NOT be eligible (depends on A)"
    );
    assert!(
        !eligible_ids.contains(&id_c.as_str()),
        "C should NOT be eligible (depends on A)"
    );
    assert!(
        !eligible_ids.contains(&id_d.as_str()),
        "D should NOT be eligible (depends on B,C)"
    );

    // --- Phase 2: Complete A → B and C unblock ---
    env.set_output(
        &id_a,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "A done".into(),
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&id_a).unwrap();

    // Pre-set outputs for B and C (they'll be spawned after A's review completes)
    env.set_output(
        &id_b,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "B done".into(),
        },
    );
    env.set_output(
        &id_c,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "C done".into(),
        },
    );
    env.set_output(
        &id_a,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "A looks good".into(),
        },
    );
    env.tick_until_settled();

    // A should be Done (review is automated)
    let a = env.api().get_task(&id_a).unwrap();
    assert!(a.is_done(), "A should be Done, got: {:?}", a.status);

    // B and C should be active (unblocked by A completing)
    let b = env.api().get_task(&id_b).unwrap();
    let c = env.api().get_task(&id_c).unwrap();
    assert!(
        b.status.is_active(),
        "B should be active after A done, got: {:?}",
        b.status
    );
    assert!(
        c.status.is_active(),
        "C should be active after A done, got: {:?}",
        c.status
    );

    // D should still be blocked (B and C not done yet)
    let eligible = env.api().get_tasks_needing_agents().unwrap();
    let eligible_ids: Vec<&str> = eligible.iter().map(|t| t.id.as_str()).collect();
    assert!(
        !eligible_ids.contains(&id_d.as_str()),
        "D should NOT be eligible while B and C are still active"
    );

    // --- Phase 3: Complete B and C → D unblocks ---
    let _ = env.api().approve(&id_b).unwrap();
    let _ = env.api().approve(&id_c).unwrap();

    // Pre-set D's work output (it'll be spawned after B and C reviews complete)
    env.set_output(
        &id_d,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "D done".into(),
        },
    );
    env.set_output(
        &id_b,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "B looks good".into(),
        },
    );
    env.set_output(
        &id_c,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "C looks good".into(),
        },
    );
    env.tick_until_settled();

    let b = env.api().get_task(&id_b).unwrap();
    let c = env.api().get_task(&id_c).unwrap();
    assert!(b.is_done(), "B should be Done, got: {:?}", b.status);
    assert!(c.is_done(), "C should be Done, got: {:?}", c.status);

    // D should now be active (both deps satisfied)
    let d = env.api().get_task(&id_d).unwrap();
    assert!(
        d.status.is_active(),
        "D should be active after B and C done, got: {:?}",
        d.status
    );

    // --- Phase 4: Complete D → parent advances ---
    let _ = env.api().approve(&id_d).unwrap();

    env.set_output(
        &id_d,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "D looks good".into(),
        },
    );
    env.tick_until_settled();

    let d = env.api().get_task(&id_d).unwrap();
    assert!(d.is_done(), "D should be Done, got: {:?}", d.status);

    // Tick to trigger parent completion check
    env.tick();

    let parent = env.api().get_task(&parent.id).unwrap();
    assert_eq!(
        parent.current_stage(),
        Some("work"),
        "Parent should advance to 'work' after all diamond subtasks complete. Status: {:?}",
        parent.status
    );
}

// =============================================================================
// Breakdown Skip (No Subtasks)
// =============================================================================

#[test]
fn test_breakdown_skip_advances_normally() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let parent = env.create_task("Simple task", "Easy enough", None);

    // Planning
    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Simple plan".into(),
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    // Breakdown: skip (empty subtasks with reason)
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            subtasks: vec![],
            skip_reason: Some("Task is simple enough to complete directly".into()),
        },
    );
    env.tick_until_settled();

    // Approve the skipped breakdown
    let parent = env.api().approve(&parent.id).unwrap();

    // Should advance normally to work stage (no subtasks created)
    assert_eq!(
        parent.current_stage(),
        Some("work"),
        "Should advance to work stage when breakdown is skipped"
    );

    // No subtasks should exist
    let subtasks = env.api().list_subtasks(&parent.id).unwrap();
    assert!(subtasks.is_empty(), "No subtasks should be created on skip");
}

// =============================================================================
// Subtask Failure Fails Parent
// =============================================================================

#[test]
fn test_subtask_failure_fails_parent() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Setup parent with subtasks
    let parent = env.create_task("Feature", "Build it", None);

    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan".into(),
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            subtasks: vec![SubtaskOutput {
                title: "Only task".into(),
                description: "Will fail".into(),
                depends_on: vec![],
            }],
            skip_reason: None,
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    let subtasks = env.api().list_subtasks(&parent.id).unwrap();
    let subtask_id = subtasks[0].id.clone();

    // Wait for setup
    for _ in 0..100 {
        std::thread::sleep(std::time::Duration::from_millis(20));
        let s = env.api().get_task(&subtask_id).unwrap();
        if s.phase != orkestra_core::workflow::runtime::Phase::SettingUp {
            break;
        }
    }

    // Fail the subtask
    env.set_output(
        &subtask_id,
        MockAgentOutput::Failed {
            error: "Build error".into(),
        },
    );
    env.tick_until_settled();

    // Tick to trigger parent completion check
    env.tick();

    // Parent should be failed
    let parent = env.api().get_task(&parent.id).unwrap();
    assert!(
        parent.is_failed(),
        "Parent should be Failed when subtask fails, got: {:?}",
        parent.status
    );
}
