//! End-to-end tests for the subtask system.
//!
//! Tests the full lifecycle: breakdown → subtask creation → dependency-aware
//! orchestration → integration → parent completion detection.
//!
//! Key behaviors tested:
//! - Subtask setup is deferred to orchestrator tick (not immediate at creation)
//! - Dependent subtasks stay in `SettingUp` until dependencies are Done
//! - Each subtask gets its own worktree branching from the parent's branch
//! - Subtask integration merges to parent's branch (not primary)
//! - Parent advances only when ALL subtasks are Archived (integrated)

use std::path::Path;

use orkestra_core::workflow::execution::SubtaskOutput;
use orkestra_core::workflow::runtime::TaskState;

use super::helpers::{enable_auto_merge, workflows, MockAgentOutput, TestEnv};

// =============================================================================
// Helper: Drive a parent through planning + breakdown + approval
// =============================================================================

/// Create parent task, produce plan, approve, produce breakdown, approve.
/// Returns (`parent_id`, `subtask_ids_by_title`).
fn setup_parent_with_subtasks(
    env: &TestEnv,
    subtask_outputs: Vec<SubtaskOutput>,
    base_branch: Option<&str>,
) -> (String, Vec<(String, String)>) {
    let parent = env.create_task("Feature", "Build it", base_branch);

    // Planning
    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan".into(),
            activity_log: None,
        },
    );
    env.advance(); // spawns planner (completion ready)
    env.advance(); // processes plan output
    env.api().approve(&parent.id).unwrap();
    env.advance(); // commit pipeline: Finishing → Finished → advance to breakdown

    // Breakdown
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            content: "Technical design".into(),
            subtasks: subtask_outputs,
            skip_reason: None,
            activity_log: None,
        },
    );
    env.advance(); // spawns breakdown agent (completion ready)
    env.advance(); // processes breakdown output
    env.api().approve(&parent.id).unwrap();
    env.advance(); // commit pipeline: Finishing → Finished → advance (creates subtasks)

    let subtasks = env.api().list_subtasks(&parent.id).unwrap();
    let id_map: Vec<(String, String)> = subtasks
        .iter()
        .map(|s| (s.title.clone(), s.id.clone()))
        .collect();

    (parent.id, id_map)
}

/// Complete a single subtask through work → approve → review → Done.
///
/// Work is non-automated (needs approval), review is automated (auto-advances).
///
/// **Important:** Only safe when no other independent subtasks are ready for agents.
/// If sibling subtasks are also eligible, use `complete_subtasks` instead to
/// pre-set outputs for all of them before ticking.
fn complete_subtask(env: &TestEnv, subtask_id: &str) {
    complete_subtasks(env, &[subtask_id]);
}

/// Complete multiple subtasks in parallel through work → approve → review → Done.
///
/// Sets work outputs for ALL subtasks before ticking, so the orchestrator can start
/// all agents in the same tick without any failing due to missing mock outputs.
fn complete_subtasks(env: &TestEnv, subtask_ids: &[&str]) {
    // 1. Queue work outputs for all subtasks
    for &id in subtask_ids {
        env.set_output(
            id,
            MockAgentOutput::Artifact {
                name: "summary".into(),
                content: format!("Work done for {id}"),
                activity_log: None,
            },
        );
    }
    env.advance(); // spawns work agents for all subtasks (completions ready)
    env.advance(); // processes all work outputs

    // 2. Approve all (work stage is non-automated → AwaitingReview)
    for &id in subtask_ids {
        let task = env.api().get_task(id).unwrap();
        assert!(
            matches!(task.state, TaskState::AwaitingApproval { .. }),
            "Subtask {id} should be AwaitingApproval after work stage, got: {:?}",
            task.state
        );
        env.api().approve(id).expect("Should approve work stage");
    }
    env.advance(); // commit pipeline: Finishing → Finished → advance to review

    // 3. Queue review outputs for all subtasks
    for &id in subtask_ids {
        env.set_output(
            id,
            MockAgentOutput::Artifact {
                name: "verdict".into(),
                content: "Looks good".into(),
                activity_log: None,
            },
        );
    }
    env.advance(); // spawns review agents (completions ready)
    env.advance(); // processes review outputs → auto-approve → Done

    // 4. Verify all are Done or Archived
    for &id in subtask_ids {
        let task = env.api().get_task(id).unwrap();
        assert!(
            task.is_done() || task.is_archived(),
            "Subtask {id} should be Done or Archived after work+review, got: {:?}",
            task.state
        );
    }
}

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
            activity_log: None,
        },
    );
    env.advance(); // spawns planner (completion ready)
    env.advance(); // processes plan output

    // Approve the plan
    env.api().approve(&parent.id).unwrap();
    env.advance(); // commit pipeline: Finishing → Finished → advance to breakdown
    let parent = env.api().get_task(&parent.id).unwrap();
    assert_eq!(parent.current_stage(), Some("breakdown"));

    // Breakdown stage: produce subtasks
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            content: "Technical design content".into(),
            subtasks: vec![
                SubtaskOutput {
                    title: "Setup database".into(),
                    description: "Create schema and migrations".into(),
                    detailed_instructions: "Implementation brief for database setup".into(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Build API".into(),
                    description: "Create REST endpoints".into(),
                    detailed_instructions: "Implementation brief for API endpoints".into(),
                    depends_on: vec![0],
                },
                SubtaskOutput {
                    title: "Build UI".into(),
                    description: "Create frontend components".into(),
                    detailed_instructions: "Implementation brief for UI components".into(),
                    depends_on: vec![0],
                },
            ],
            skip_reason: None,
            activity_log: None,
        },
    );
    env.advance(); // spawns breakdown agent (completion ready)
    env.advance(); // processes subtasks output

    // Parent should be awaiting review with breakdown artifact
    let parent = env.api().get_task(&parent.id).unwrap();
    assert!(parent.needs_review(), "Parent should need review");
    assert!(parent.artifact("breakdown").is_some());

    // Approve the breakdown - this should create subtasks
    env.api().approve(&parent.id).unwrap();
    env.advance(); // commit pipeline: Finishing → Finished → advance (creates subtasks)
    let parent = env.api().get_task(&parent.id).unwrap();
    assert!(
        parent.state.is_waiting_on_children(),
        "Parent should be WaitingOnChildren, got: {:?}",
        parent.state
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

    // All subtasks start in AwaitingSetup (setup is deferred to orchestrator tick)
    for subtask in &subtasks {
        assert_eq!(subtask.current_stage(), Some("work"));
        assert!(
            matches!(subtask.state, TaskState::AwaitingSetup { .. }),
            "Subtask should start in AwaitingSetup (deferred setup), got: {:?}",
            subtask.state
        );
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

    // Subtasks should have a per-subtask breakdown artifact from detailed_instructions
    for subtask in &subtasks {
        assert!(
            subtask.artifact("breakdown").is_some(),
            "Subtask should have per-subtask breakdown artifact"
        );
    }

    // Subtasks should have base_branch set to parent's branch
    let parent_branch = parent.branch_name.clone().unwrap_or_default();
    for subtask in &subtasks {
        assert_eq!(
            subtask.base_branch, parent_branch,
            "Subtask base_branch should be parent's branch"
        );
    }
}

// =============================================================================
// Dependency-Aware Setup and Orchestration
// =============================================================================

#[test]
fn test_dependency_aware_orchestration() {
    // No enable_auto_merge — subtasks auto-merge regardless of the setting
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
            SubtaskOutput {
                title: "First".into(),
                description: "Independent task".into(),
                detailed_instructions: "Implementation brief for first task".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Second".into(),
                description: "Depends on first".into(),
                detailed_instructions: "Implementation brief for second task".into(),
                depends_on: vec![0],
            },
        ],
        None,
    );

    let first_id = id_map.iter().find(|(t, _)| t == "First").unwrap().1.clone();
    let second_id = id_map
        .iter()
        .find(|(t, _)| t == "Second")
        .unwrap()
        .1
        .clone();

    // --- Phase 1: Only first subtask gets set up (no deps) ---
    // Second stays in AwaitingSetup because its dep (first) isn't Archived yet
    env.advance(); // setup_awaiting_tasks: sets up first (no deps), skips second

    let second = env.api().get_task(&second_id).unwrap();
    assert!(
        matches!(second.state, TaskState::AwaitingSetup { .. }),
        "Second subtask should still be in AwaitingSetup (dep not met), got: {:?}",
        second.state
    );

    // First should be eligible for agents, second should NOT
    let eligible = env.api().get_tasks_needing_agents().unwrap();
    let eligible_ids: Vec<&str> = eligible.iter().map(|t| t.id.as_str()).collect();
    assert!(
        eligible_ids.contains(&first_id.as_str()),
        "First subtask (no deps) should be eligible"
    );
    assert!(
        !eligible_ids.contains(&second_id.as_str()),
        "Second subtask (dep not met) should NOT be eligible"
    );

    // --- Phase 2: Complete first subtask → second's dep is satisfied ---
    // complete_subtask drives through work → review → Done → integration (sync) → Archived.
    complete_subtask(&env, &first_id);
    env.advance(); // setup_awaiting_tasks: first is Archived, sets up second

    // Second should now be active and eligible
    let second = env.api().get_task(&second_id).unwrap();
    assert!(
        second.state.is_active(),
        "Second subtask should be active after dep satisfied and setup complete, got: {:?}",
        second.state
    );

    // Verify second subtask got its own worktree
    assert!(
        second.worktree_path.is_some(),
        "Second subtask should have its own worktree"
    );

    // Clean up: avoid leaking parent worktree on assertion failures
    let _ = env.api().delete_task_with_cleanup(&parent_id);
}

// =============================================================================
// Parent Completion Detection (requires subtask integration)
// =============================================================================

#[test]
#[allow(clippy::too_many_lines)]
fn test_parent_advances_when_all_subtasks_done() {
    let workflow = enable_auto_merge(workflows::with_subtasks());
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
            SubtaskOutput {
                title: "First".into(),
                description: "Task 1".into(),
                detailed_instructions: "Implementation brief for task 1".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Second".into(),
                description: "Task 2".into(),
                detailed_instructions: "Implementation brief for task 2".into(),
                depends_on: vec![],
            },
        ],
        None,
    );

    let first_id = id_map.iter().find(|(t, _)| t == "First").unwrap().1.clone();
    let second_id = id_map
        .iter()
        .find(|(t, _)| t == "Second")
        .unwrap()
        .1
        .clone();

    // Both subtasks have no deps, so both set up on first advance
    env.advance(); // setup_awaiting_tasks: sets up both (no deps)

    // Write a file in each subtask's worktree (simulating agent making changes)
    let first_task = env.api().get_task(&first_id).unwrap();
    let first_wt = first_task.worktree_path.as_ref().unwrap();
    std::fs::write(
        Path::new(first_wt).join("first.txt"),
        "from first subtask\n",
    )
    .expect("Should write file to first subtask worktree");

    let second_task = env.api().get_task(&second_id).unwrap();
    let second_wt = second_task.worktree_path.as_ref().unwrap();
    std::fs::write(
        Path::new(second_wt).join("second.txt"),
        "from second subtask\n",
    )
    .expect("Should write file to second subtask worktree");

    // Pre-set parent's work output before completing subtasks.
    // Once subtasks are archived (integration complete), the parent advances
    // and the orchestrator spawns the work agent immediately.
    env.set_output(
        &parent_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Parent work".into(),
            activity_log: None,
        },
    );

    // Complete both subtasks in parallel (both are independent, both eligible at once)
    complete_subtasks(&env, &[&first_id, &second_id]);

    // complete_subtasks integrates one subtask (one-at-a-time) in its last advance.
    // One more advance integrates the remaining one.
    env.advance(); // integrates second Done subtask → Archived

    // Both Archived now. Advance triggers check_parent_completions → parent advances.
    env.advance();

    // Parent should have advanced to the next stage after breakdown (work)
    let parent = env.api().get_task(&parent_id).unwrap();
    assert_eq!(
        parent.current_stage(),
        Some("work"),
        "Parent should advance to 'work' stage after all subtasks are Archived. State: {:?}",
        parent.state
    );

    // Verify both subtask files are visible in the parent worktree (no manual git reset needed)
    let parent_wt = parent.worktree_path.as_ref().unwrap();
    assert!(
        Path::new(parent_wt).join("first.txt").exists(),
        "first.txt should exist in parent worktree after subtask integration"
    );
    assert!(
        Path::new(parent_wt).join("second.txt").exists(),
        "second.txt should exist in parent worktree after subtask integration"
    );
}

// =============================================================================
// Diamond Dependency Pattern (Fan-Out / Fan-In)
// =============================================================================

#[test]
#[allow(clippy::too_many_lines)]
fn test_diamond_dependency_orchestration() {
    let workflow = enable_auto_merge(workflows::with_subtasks());
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (_parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
            SubtaskOutput {
                title: "Node A".into(),
                description: "Root node, no deps".into(),
                detailed_instructions: "Implementation brief for node A".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Node B".into(),
                description: "Depends on A".into(),
                detailed_instructions: "Implementation brief for node B".into(),
                depends_on: vec![0],
            },
            SubtaskOutput {
                title: "Node C".into(),
                description: "Depends on A".into(),
                detailed_instructions: "Implementation brief for node C".into(),
                depends_on: vec![0],
            },
            SubtaskOutput {
                title: "Node D".into(),
                description: "Depends on B and C (fan-in)".into(),
                detailed_instructions: "Implementation brief for node D".into(),
                depends_on: vec![1, 2],
            },
        ],
        None,
    );

    let id_a = id_map
        .iter()
        .find(|(t, _)| t == "Node A")
        .unwrap()
        .1
        .clone();
    let id_b = id_map
        .iter()
        .find(|(t, _)| t == "Node B")
        .unwrap()
        .1
        .clone();
    let id_c = id_map
        .iter()
        .find(|(t, _)| t == "Node C")
        .unwrap()
        .1
        .clone();
    let id_d = id_map
        .iter()
        .find(|(t, _)| t == "Node D")
        .unwrap()
        .1
        .clone();

    // --- Phase 1: Only A gets set up (no deps) ---
    env.advance(); // setup_awaiting_tasks: sets up A (no deps), skips B/C/D

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
        !eligible_ids.contains(&id_d.as_str()),
        "D should NOT be eligible (depends on B,C)"
    );

    // B, C, D should all still be in AwaitingSetup
    for id in [&id_b, &id_c, &id_d] {
        let task = env.api().get_task(id).unwrap();
        assert!(
            matches!(task.state, TaskState::AwaitingSetup { .. }),
            "Task {} should be in AwaitingSetup, got: {:?}",
            task.title,
            task.state
        );
    }

    // --- Phase 2: Complete A → B and C unblock ---
    // complete_subtask drives through work → review → Done → integration (sync) → Archived.
    complete_subtask(&env, &id_a);
    env.advance(); // setup_awaiting_tasks: A is Archived, sets up B and C

    // B and C should be active
    let b = env.api().get_task(&id_b).unwrap();
    let c = env.api().get_task(&id_c).unwrap();
    assert!(
        b.state.is_active(),
        "B should be active after A done, got: {:?}",
        b.state
    );
    assert!(
        c.state.is_active(),
        "C should be active after A done, got: {:?}",
        c.state
    );

    // D should still be in AwaitingSetup (B and C not done yet)
    let d = env.api().get_task(&id_d).unwrap();
    assert!(
        matches!(d.state, TaskState::AwaitingSetup { .. }),
        "D should still be in AwaitingSetup (B,C not done), got: {:?}",
        d.state
    );

    // --- Phase 3: Complete B and C in parallel → D unblocks ---
    // complete_subtasks drives both through work → review → Done.
    // Integration is one-at-a-time: the last advance integrates one of B/C (sync → Archived).
    complete_subtasks(&env, &[&id_b, &id_c]);
    env.advance(); // integrates the remaining one of B/C (Done→Archived)
    env.advance(); // setup_awaiting_tasks: B and C both Archived, sets up D

    // D should be active
    let d = env.api().get_task(&id_d).unwrap();
    assert!(
        d.state.is_active(),
        "D should be active after B and C done, got: {:?}",
        d.state
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
            activity_log: None,
        },
    );
    env.advance(); // spawns planner (completion ready)
    env.advance(); // processes plan output
    env.api().approve(&parent.id).unwrap();
    env.advance(); // commit pipeline: Finishing → Finished → advance to breakdown

    // Breakdown: skip (empty subtasks with reason)
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            content: "Technical design content".into(),
            subtasks: vec![],
            skip_reason: Some("Task is simple enough to complete directly".into()),
            activity_log: None,
        },
    );
    env.advance(); // spawns breakdown agent (completion ready)
    env.advance(); // processes skip output

    // Approve the skipped breakdown
    env.api().approve(&parent.id).unwrap();
    env.advance(); // commit pipeline: Finishing → Finished → advance to work
    let parent = env.api().get_task(&parent.id).unwrap();

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
// Subtask Failure: Parent Stays in WaitingOnChildren
// =============================================================================

#[test]
fn test_subtask_failure_parent_stays_waiting() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![SubtaskOutput {
            title: "Only task".into(),
            description: "Will fail".into(),
            detailed_instructions: "Implementation brief for failing task".into(),
            depends_on: vec![],
        }],
        None,
    );

    let subtask_id = id_map[0].1.clone();

    // Set up subtask (no deps)
    env.advance(); // setup_awaiting_tasks: sets up subtask

    // Fail the subtask
    env.set_output(
        &subtask_id,
        MockAgentOutput::Failed {
            error: "Build error".into(),
        },
    );
    env.advance(); // spawns agent (completion ready)
    env.advance(); // processes failure output
    env.advance(); // check_parent_completions - parent should NOT fail

    // Parent should stay in WaitingOnChildren (subtask can be retried)
    let parent = env.api().get_task(&parent_id).unwrap();
    assert!(
        parent.state.is_waiting_on_children(),
        "Parent should stay in WaitingOnChildren when subtask fails, got: {:?}",
        parent.state
    );

    // Subtask should be Failed but can be retried
    let subtask = env.api().get_task(&subtask_id).unwrap();
    assert!(
        subtask.is_failed(),
        "Subtask should be Failed, got: {:?}",
        subtask.state
    );
}

// =============================================================================
// Subtask Worktree Isolation
// =============================================================================

#[test]
fn test_subtask_worktrees_are_isolated() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
            SubtaskOutput {
                title: "Alpha".into(),
                description: "First subtask".into(),
                detailed_instructions: "Implementation brief for alpha".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Beta".into(),
                description: "Second subtask".into(),
                detailed_instructions: "Implementation brief for beta".into(),
                depends_on: vec![],
            },
        ],
        None,
    );

    let alpha_id = id_map.iter().find(|(t, _)| t == "Alpha").unwrap().1.clone();
    let beta_id = id_map.iter().find(|(t, _)| t == "Beta").unwrap().1.clone();

    // Both have no deps, set up on first advance
    env.advance(); // setup_awaiting_tasks: sets up both

    let parent = env.api().get_task(&parent_id).unwrap();
    let alpha = env.api().get_task(&alpha_id).unwrap();
    let beta = env.api().get_task(&beta_id).unwrap();

    // Each subtask should have its own unique worktree
    assert_ne!(
        alpha.worktree_path, beta.worktree_path,
        "Subtasks should have different worktree paths"
    );
    assert_ne!(
        alpha.branch_name, beta.branch_name,
        "Subtasks should have different branch names"
    );

    // Subtask worktrees should differ from parent's
    assert_ne!(
        alpha.worktree_path, parent.worktree_path,
        "Subtask worktree should differ from parent"
    );

    // Subtasks should branch from parent's branch
    let parent_branch = parent.branch_name.clone().unwrap_or_default();
    assert_eq!(alpha.base_branch, parent_branch);
    assert_eq!(beta.base_branch, parent_branch);

    // All worktrees should exist on disk
    for task in [&parent, &alpha, &beta] {
        let wt = task.worktree_path.as_ref().unwrap();
        assert!(Path::new(wt).exists(), "Worktree should exist at {wt}");
    }
}

// =============================================================================
// Subtask Integration (merges to parent branch)
// =============================================================================

#[test]
fn test_subtask_integration_merges_to_parent_branch() {
    let workflow = enable_auto_merge(workflows::with_subtasks());
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![SubtaskOutput {
            title: "Worker".into(),
            description: "Makes file changes".into(),
            detailed_instructions: "Implementation brief for worker".into(),
            depends_on: vec![],
        }],
        None,
    );

    let subtask_id = id_map[0].1.clone();
    env.advance(); // setup_awaiting_tasks: sets up subtask (no deps)

    // Write a file in the subtask's worktree (simulating agent making changes)
    let subtask = env.api().get_task(&subtask_id).unwrap();
    let wt_path = subtask.worktree_path.as_ref().unwrap();
    std::fs::write(
        Path::new(wt_path).join("feature.txt"),
        "implemented by subtask\n",
    )
    .expect("Should write file to subtask worktree");

    // complete_subtask drives through work → review → Done → integration (sync) → Archived.
    complete_subtask(&env, &subtask_id);

    let subtask = env.api().get_task(&subtask_id).unwrap();
    assert!(
        subtask.is_archived(),
        "Subtask should be Archived after integration, got: {:?}",
        subtask.state
    );

    // Verify the file was merged to the parent's branch:
    // The merge runs inside the worktree, so the working directory updates automatically.
    let parent = env.api().get_task(&parent_id).unwrap();
    let parent_wt = parent.worktree_path.as_ref().unwrap();

    let feature_file = Path::new(parent_wt).join("feature.txt");
    assert!(
        feature_file.exists(),
        "Feature file should exist in parent worktree after subtask merge"
    );
}

// =============================================================================
// Integration Conflict (two subtasks editing the same file)
// =============================================================================

#[test]
#[allow(clippy::too_many_lines)]
fn test_subtask_integration_conflict() {
    let workflow = enable_auto_merge(workflows::with_subtasks());
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Use a random base branch so hardcoded "main" can never pass the assertion.
    let base_branch = format!("feature/{}", uuid::Uuid::new_v4().as_simple());
    std::process::Command::new("git")
        .args(["branch", &base_branch])
        .current_dir(env.repo_path())
        .output()
        .unwrap();

    let (_parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
            SubtaskOutput {
                title: "Sub A".into(),
                description: "Edits shared file one way".into(),
                detailed_instructions: "Implementation brief for sub A".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Sub B".into(),
                description: "Edits shared file another way".into(),
                detailed_instructions: "Implementation brief for sub B".into(),
                depends_on: vec![],
            },
        ],
        Some(&base_branch),
    );

    let id_a = id_map.iter().find(|(t, _)| t == "Sub A").unwrap().1.clone();
    let id_b = id_map.iter().find(|(t, _)| t == "Sub B").unwrap().1.clone();

    // Both have no deps, set up on first advance
    env.advance(); // setup_awaiting_tasks: sets up both

    // Write CONFLICTING changes to the same file in both worktrees
    let a = env.api().get_task(&id_a).unwrap();
    let b = env.api().get_task(&id_b).unwrap();

    let a_wt = a.worktree_path.as_ref().unwrap();
    let b_wt = b.worktree_path.as_ref().unwrap();

    std::fs::write(
        Path::new(a_wt).join("shared.txt"),
        "implementation A\nline 2 from A\nline 3 from A\n",
    )
    .expect("Should write to A's worktree");

    std::fs::write(
        Path::new(b_wt).join("shared.txt"),
        "implementation B\nline 2 from B\nline 3 from B\n",
    )
    .expect("Should write to B's worktree");

    // Drive both subtasks through work → approve → review.
    // Don't use complete_subtasks() because with instant integration, the conflicting
    // subtask may already be back in Active/"work" by the time assertions run.
    for id in [&id_a, &id_b] {
        env.set_output(
            id,
            MockAgentOutput::Artifact {
                name: "summary".into(),
                content: format!("Work done for {id}"),
                activity_log: None,
            },
        );
    }
    env.advance(); // spawns work agents (completions ready)
    env.advance(); // processes work outputs

    for id in [&id_a, &id_b] {
        let task = env.api().get_task(id).unwrap();
        assert!(
            matches!(task.state, TaskState::AwaitingApproval { .. }),
            "Subtask {id} should be AwaitingApproval, got: {:?}",
            task.state
        );
        env.api().approve(id).expect("Should approve work stage");
    }

    // Queue review verdict AND recovery work outputs before advancing.
    // The mock queue is FIFO per task: review agent consumes "verdict" first,
    // then if integration fails and recovers to work, the recovery agent
    // consumes "summary". We don't know which subtask will conflict, so
    // queue both outputs for both subtasks.
    for id in [&id_a, &id_b] {
        env.set_output(
            id,
            MockAgentOutput::Artifact {
                name: "verdict".into(),
                content: "Looks good".into(),
                activity_log: None,
            },
        );
        env.set_output(
            id,
            MockAgentOutput::Artifact {
                name: "summary".into(),
                content: format!("Recovery work for {id}"),
                activity_log: None,
            },
        );
    }
    env.advance(); // spawns review agents (completions ready)
    env.advance(); // processes reviews → auto-approve → Done
                   // Integration is sync: one task per advance. After review, tasks are Done.
                   // First integration may conflict, triggering recovery → work agent spawn.
    env.advance(); // integrates first task (sync); may spawn recovery agent
    env.advance(); // integrates second task (or processes recovery output)
    env.advance(); // catch-up for any remaining cascading work

    // Integration order is nondeterministic — one merged cleanly, the other conflicted.
    // Find which one was archived and which was recovered.
    let a_task = env.api().get_task(&id_a).unwrap();
    let b_task = env.api().get_task(&id_b).unwrap();
    let conflict_id = if a_task.is_archived() {
        &id_b
    } else if b_task.is_archived() {
        &id_a
    } else {
        panic!(
            "Expected one task to be Archived. A: {:?}, B: {:?}",
            a_task.state, b_task.state
        );
    };

    let conflict_task = env.api().get_task(conflict_id).unwrap();
    // Should be back in the work stage (recovery from integration failure)
    assert_eq!(
        conflict_task.current_stage(),
        Some("work"),
        "Conflicting subtask should be moved to recovery stage, got: {:?}",
        conflict_task.state
    );
    assert!(
        conflict_task.state.is_active(),
        "Conflicting subtask should be active after recovery, got: {:?}",
        conflict_task.state
    );

    // VERIFY: The recovery prompt must tell the agent to rebase on the parent's branch,
    // not a hardcoded "main". The parent was created from our random base_branch, so
    // subtasks get base_branch = parent's branch_name (e.g. "task/TASK-001").
    // We check against the task's base_branch (which derives from the parent's branch_name).
    let expected_rebase = format!("git rebase {}", conflict_task.base_branch);
    let recovery_prompt = env.last_prompt_for(conflict_id);
    assert!(
        recovery_prompt.contains(&expected_rebase),
        "Recovery prompt should contain '{expected_rebase}', got prompt:\n{}",
        &recovery_prompt[..recovery_prompt.len().min(300)]
    );
    // Sanity: base_branch must NOT be "main" — subtasks rebase onto parent's branch
    assert_ne!(
        conflict_task.base_branch, "main",
        "Subtask base_branch should be the parent's branch, not main"
    );
}

/// Test that archived subtasks appear in `list_subtask_views` and count in progress.
#[test]
#[allow(clippy::too_many_lines)]
fn test_archived_subtasks_included_in_views_and_progress() {
    let env = TestEnv::with_git(
        &enable_auto_merge(workflows::with_subtasks()),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    let (parent_id, subtask_ids) = setup_parent_with_subtasks(
        &env,
        vec![
            SubtaskOutput {
                title: "Subtask A".into(),
                description: "Do A".into(),
                detailed_instructions: "Implementation brief for subtask A".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Subtask B".into(),
                description: "Do B".into(),
                detailed_instructions: "Implementation brief for subtask B".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Subtask C".into(),
                description: "Do C".into(),
                detailed_instructions: "Implementation brief for subtask C".into(),
                depends_on: vec![],
            },
        ],
        None,
    );

    let id_a = &subtask_ids[0].1;
    let id_b = &subtask_ids[1].1;
    let id_c = &subtask_ids[2].1;

    // Setup ready subtasks (all have no dependencies)
    env.advance();

    // Complete subtasks A and B together, leaving C incomplete
    // Set mock outputs for all 3 to avoid failures when orchestrator spawns agents
    env.set_output(
        id_a,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done for A".into(),
            activity_log: None,
        },
    );
    env.set_output(
        id_b,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done for B".into(),
            activity_log: None,
        },
    );
    // Set a mock output for C but don't approve it, so it stays in AwaitingReview
    env.set_output(
        id_c,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done for C".into(),
            activity_log: None,
        },
    );

    env.advance(); // spawns work agents for all 3 subtasks
    env.advance(); // processes all work outputs → AwaitingReview

    // Approve only A and B, leaving C awaiting review
    env.api().approve(id_a).unwrap();
    env.api().approve(id_b).unwrap();

    // Set review outputs for A and B
    env.set_output(
        id_a,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "Looks good".into(),
            activity_log: None,
        },
    );
    env.set_output(
        id_b,
        MockAgentOutput::Artifact {
            name: "verdict".into(),
            content: "Looks good".into(),
            activity_log: None,
        },
    );

    env.advance(); // spawns review agents for A and B
    env.advance(); // processes review outputs → Done
    env.advance(); // integrates A → Archived
    env.advance(); // integrates B → Archived

    let task_a = env.api().get_task(id_a).unwrap();
    let task_b = env.api().get_task(id_b).unwrap();
    assert!(
        task_a.is_archived(),
        "Subtask A should be archived after integration"
    );
    assert!(
        task_b.is_archived(),
        "Subtask B should be archived after integration"
    );

    // Subtask C is awaiting review

    // Check list_subtask_views includes archived subtasks
    let subtask_views = env.api().list_subtask_views(&parent_id).unwrap();
    assert_eq!(
        subtask_views.len(),
        3,
        "Should include all 3 subtasks including archived ones"
    );

    // Verify archived subtasks are present
    let archived_count = subtask_views
        .iter()
        .filter(|v| v.derived.is_archived)
        .count();
    assert_eq!(archived_count, 2, "Should have 2 archived subtasks");

    // Check parent's task view includes archived subtasks in progress
    let task_views = env.api().list_task_views().unwrap();
    let parent_view = task_views.iter().find(|v| v.task.id == parent_id).unwrap();

    let progress = parent_view
        .derived
        .subtask_progress
        .as_ref()
        .expect("Parent should have subtask progress");

    assert_eq!(progress.total, 3, "Total should include all subtasks");
    assert_eq!(
        progress.done, 2,
        "Done count should include both archived subtasks"
    );
    // Subtask C is awaiting review
    assert_eq!(
        progress.needs_review, 1,
        "One subtask should be awaiting review. Progress: {progress:?}"
    );
}

// =============================================================================
// Stale structured artifact after re-run
// =============================================================================

/// When breakdown is rejected and re-run with empty subtasks, the stale
/// `_structured` artifact from the first run must be cleared. Otherwise
/// approval incorrectly creates subtasks from the stale data.
#[test]
fn rerun_breakdown_with_no_subtasks_clears_stale_structured_artifact() {
    let wf = workflows::with_subtasks();
    let env = TestEnv::with_git(&wf, &["planner", "breakdown", "worker", "reviewer"]);

    let parent = env.create_task("Feature", "Build it", None);

    // Planning → approve
    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "The plan".into(),
            activity_log: None,
        },
    );
    env.advance(); // spawns planner
    env.advance(); // processes plan output
    env.api().approve(&parent.id).unwrap();
    env.advance(); // commit pipeline: Finishing → Finished → advance to breakdown

    // Breakdown #1: produces subtasks → AwaitingReview
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            content: "Technical design".into(),
            subtasks: vec![SubtaskOutput {
                title: "Subtask A".into(),
                description: "Do A".into(),
                detailed_instructions: "Implement A".into(),
                depends_on: vec![],
            }],
            skip_reason: None,
            activity_log: None,
        },
    );
    env.advance(); // spawns breakdown agent
    env.advance(); // processes breakdown output

    let task = env.api().get_task(&parent.id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Should be awaiting approval after breakdown, got: {:?}",
        task.state
    );

    // Reject breakdown → stays in breakdown stage, new iteration
    env.api()
        .reject(&parent.id, "Don't break this down, just do it directly")
        .unwrap();

    // Breakdown #2: empty subtasks with skip reason
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            content: "Will implement directly".into(),
            subtasks: vec![],
            skip_reason: Some("Task is simple enough to implement directly".into()),
            activity_log: None,
        },
    );
    env.advance(); // spawns breakdown agent (new iteration)
    env.advance(); // processes breakdown output

    let task = env.api().get_task(&parent.id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Should be awaiting approval after second breakdown, got: {:?}",
        task.state
    );

    // Approve → should NOT create subtasks, should advance to work stage
    env.api().approve(&parent.id).unwrap();
    env.advance(); // commit pipeline: Finishing → Finished → advance to work

    let task = env.api().get_task(&parent.id).unwrap();
    let subtasks = env.api().list_subtasks(&parent.id).unwrap();

    assert!(
        subtasks.is_empty(),
        "No subtasks should exist after approving empty breakdown, got {} subtask(s)",
        subtasks.len()
    );
    assert_eq!(
        task.current_stage().unwrap(),
        "work",
        "Task should advance to work stage, not WaitingOnChildren"
    );
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued (ready for work agent), got: {:?}",
        task.state
    );
}

// =============================================================================
// Sibling Context in Prompts
// =============================================================================

/// Verify that subtask agents receive sibling context in their prompts,
/// with correct dependency relationship markers.
#[test]
fn test_subtask_prompt_includes_sibling_context() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create subtasks: A (no deps), B (depends on A), C (depends on A)
    let subtask_outputs = vec![
        SubtaskOutput {
            title: "Setup foundation".into(),
            description: "Create base infrastructure".into(),
            detailed_instructions: "Implementation details for foundation".into(),
            depends_on: vec![],
        },
        SubtaskOutput {
            title: "Build API layer".into(),
            description: "Create REST endpoints".into(),
            detailed_instructions: "Implementation details for API".into(),
            depends_on: vec![0], // Depends on A
        },
        SubtaskOutput {
            title: "Build UI layer".into(),
            description: "Create frontend components".into(),
            detailed_instructions: "Implementation details for UI".into(),
            depends_on: vec![0], // Depends on A
        },
    ];

    let (_parent_id, id_map) = setup_parent_with_subtasks(&env, subtask_outputs, None);

    // Find subtask A ("Setup foundation")
    let subtask_a_id = id_map
        .iter()
        .find(|(title, _)| title == "Setup foundation")
        .map(|(_, id)| id.clone())
        .expect("Should find subtask A");

    // Subtask A has no dependencies, so it should be ready for setup immediately
    // Advance to run setup (creates worktree)
    env.advance();

    // Set mock output for subtask A's work stage
    env.set_output(
        &subtask_a_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done".into(),
            activity_log: None,
        },
    );

    // Advance to spawn the work agent for subtask A
    env.advance();

    // Capture the prompt
    let prompt = env.last_prompt_for(&subtask_a_id);

    // Verify sibling section exists
    assert!(
        prompt.contains("## Sibling Subtasks"),
        "Prompt should contain sibling section. Got:\n{}",
        &prompt[..prompt.len().min(2000)]
    );

    // Verify siblings B and C are listed (A should NOT be in its own list)
    assert!(
        prompt.contains("Build API layer"),
        "Sibling B should be in the list"
    );
    assert!(
        prompt.contains("Build UI layer"),
        "Sibling C should be in the list"
    );

    // Verify dependency relationships are shown
    // B and C both depend on A, so they should show "depends on this task"
    assert!(
        prompt.contains("depends on this task"),
        "Dependent siblings should show relationship marker"
    );

    // Verify current task (A) is NOT in its own sibling list
    // Count occurrences of "Setup foundation" - should only appear in task description, not siblings
    let setup_count = prompt.matches("Setup foundation").count();
    assert!(
        setup_count <= 1,
        "Current task should not appear in sibling list. Found {setup_count} occurrences"
    );

    // Verify status is shown
    assert!(
        prompt.contains("pending"),
        "Sibling status should be displayed"
    );
}
