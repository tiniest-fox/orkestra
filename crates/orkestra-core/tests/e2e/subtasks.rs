//! End-to-end tests for the subtask system.
//!
//! Tests the full lifecycle: breakdown → subtask creation → dependency-aware
//! orchestration → integration → parent completion detection.
//!
//! Key behaviors tested:
//! - Subtask setup is deferred to orchestrator tick (not immediate at creation)
//! - Dependent subtasks stay in SettingUp until dependencies are Done
//! - Each subtask gets its own worktree branching from the parent's branch
//! - Subtask integration merges to parent's branch (not primary)
//! - Parent advances only when ALL subtasks are Archived (integrated)

use std::path::Path;
use std::time::{Duration, Instant};

use orkestra_core::workflow::execution::SubtaskOutput;
use orkestra_core::workflow::runtime::Phase;

use super::helpers::{workflows, MockAgentOutput, TestEnv};

// =============================================================================
// Helper: Wait for subtask setup with orchestrator ticks
// =============================================================================

/// Trigger deferred subtask setup and wait for completion.
///
/// Convenience wrapper for `wait_for_subtask_setups` with a single task.
fn wait_for_subtask_setup(env: &TestEnv, task_id: &str) {
    wait_for_subtask_setups(env, &[task_id]);
}

/// Wait for multiple subtasks' deferred setup to complete.
///
/// Does at most ONE tick (to trigger `setup_ready_subtasks` for all eligible subtasks),
/// then polls without further ticking. This avoids a race condition where ticking for
/// a later subtask accidentally starts agents for already-setup siblings.
///
/// Uses wall-clock timeout (5s) instead of iteration count for reliability under load.
fn wait_for_subtask_setups(env: &TestEnv, task_ids: &[&str]) {
    let any_need_setup = task_ids
        .iter()
        .any(|&id| env.api().get_task(id).unwrap().phase == Phase::SettingUp);

    if !any_need_setup {
        return;
    }

    // Tick once to trigger setup_ready_subtasks for all eligible subtasks
    env.tick();

    // Poll without further ticking (setup runs in background threads)
    let start = Instant::now();
    let timeout = Duration::from_secs(5);
    while start.elapsed() < timeout {
        std::thread::sleep(Duration::from_millis(20));
        if task_ids
            .iter()
            .all(|&id| env.api().get_task(id).unwrap().phase != Phase::SettingUp)
        {
            return;
        }
    }
    let stuck: Vec<_> = task_ids
        .iter()
        .filter(|&&id| env.api().get_task(id).unwrap().phase == Phase::SettingUp)
        .collect();
    panic!("Subtask setup timed out after {:.1}s for: {stuck:?}", timeout.as_secs_f64());
}

/// Tick until a task reaches Archived status (integration complete).
///
/// Uses 10s wall-clock timeout since integration involves synchronous git
/// operations (rebase + merge + worktree cleanup) that can be slow under load.
fn wait_for_archived(env: &TestEnv, task_id: &str) {
    let task_id_owned = task_id.to_string();
    env.tick_until(
        || env.api().get_task(&task_id_owned).unwrap().is_archived(),
        Duration::from_secs(10),
        &format!("Task {task_id} did not reach Archived"),
    );
}

/// Wait for either of two tasks to reach a terminal integration state.
///
/// Returns the ID of whichever task was archived first, and the ID of the
/// remaining task. This handles nondeterministic integration ordering —
/// `start_integrations` picks one task per tick, and the order depends on
/// the store's iteration order.
fn wait_for_one_archived<'a>(
    env: &TestEnv,
    id_a: &'a str,
    id_b: &'a str,
) -> (&'a str, &'a str) {
    let (id_a_owned, id_b_owned) = (id_a.to_string(), id_b.to_string());
    let mut archived_id = None;
    env.tick_until(
        || {
            let a = env.api().get_task(&id_a_owned).unwrap();
            let b = env.api().get_task(&id_b_owned).unwrap();
            if a.is_archived() {
                archived_id = Some(id_a);
                true
            } else if b.is_archived() {
                archived_id = Some(id_b);
                true
            } else {
                false
            }
        },
        Duration::from_secs(10),
        &format!("Neither {id_a} nor {id_b} reached Archived"),
    );
    let winner = archived_id.unwrap();
    let loser = if winner == id_a { id_b } else { id_a };
    (winner, loser)
}

// =============================================================================
// Helper: Drive a parent through planning + breakdown + approval
// =============================================================================

/// Create parent task, produce plan, approve, produce breakdown, approve.
/// Returns (parent_id, subtask_ids_by_title).
fn setup_parent_with_subtasks(
    env: &TestEnv,
    subtask_outputs: Vec<SubtaskOutput>,
) -> (String, Vec<(String, String)>) {
    let parent = env.create_task("Feature", "Build it", None);

    // Planning
    env.set_output(
        &parent.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan".into(),
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

    // Breakdown
    env.set_output(
        &parent.id,
        MockAgentOutput::Subtasks {
            content: "Technical design".into(),
            subtasks: subtask_outputs,
            skip_reason: None,
        },
    );
    env.tick_until_settled();
    let _ = env.api().approve(&parent.id).unwrap();

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
            },
        );
    }
    env.tick_until_settled();

    // 2. Approve all (work stage is non-automated → AwaitingReview)
    for &id in subtask_ids {
        let task = env.api().get_task(id).unwrap();
        assert_eq!(
            task.phase,
            Phase::AwaitingReview,
            "Subtask {id} should be AwaitingReview after work stage, got: {:?}",
            task.phase
        );
        env.api().approve(id).expect("Should approve work stage");
    }

    // 3. Queue review outputs for all subtasks
    for &id in subtask_ids {
        env.set_output(
            id,
            MockAgentOutput::Artifact {
                name: "verdict".into(),
                content: "Looks good".into(),
            },
        );
    }
    env.tick_until_settled();

    // 4. Verify all are Done or Archived
    for &id in subtask_ids {
        let task = env.api().get_task(id).unwrap();
        assert!(
            task.is_done() || task.is_archived(),
            "Subtask {id} should be Done or Archived after work+review, got: {:?}",
            task.status
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
            content: "Technical design content".into(),
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

    // All subtasks start in SettingUp (setup is deferred to orchestrator tick)
    for subtask in &subtasks {
        assert_eq!(subtask.current_stage(), Some("work"));
        assert_eq!(
            subtask.phase,
            Phase::SettingUp,
            "Subtask should start in SettingUp (deferred setup)"
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

    // Subtasks should inherit parent's plan artifact
    for subtask in &subtasks {
        assert!(
            subtask.artifact("plan").is_some(),
            "Subtask should inherit plan artifact"
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
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
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
    );

    let first_id = id_map.iter().find(|(t, _)| t == "First").unwrap().1.clone();
    let second_id = id_map
        .iter()
        .find(|(t, _)| t == "Second")
        .unwrap()
        .1
        .clone();

    // --- Phase 1: Only first subtask gets set up (no deps) ---
    // Second stays in SettingUp because its dep (first) isn't Done yet
    wait_for_subtask_setup(&env, &first_id);

    let second = env.api().get_task(&second_id).unwrap();
    assert_eq!(
        second.phase,
        Phase::SettingUp,
        "Second subtask should still be in SettingUp (dep not met)"
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
    complete_subtask(&env, &first_id);

    // Wait for second subtask setup (dep now satisfied, orchestrator triggers setup)
    wait_for_subtask_setup(&env, &second_id);

    // Second should now be active and eligible
    let second = env.api().get_task(&second_id).unwrap();
    assert!(
        second.status.is_active(),
        "Second subtask should be active after dep satisfied and setup complete, got: {:?}",
        second.status
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
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
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
    );

    let first_id = id_map.iter().find(|(t, _)| t == "First").unwrap().1.clone();
    let second_id = id_map
        .iter()
        .find(|(t, _)| t == "Second")
        .unwrap()
        .1
        .clone();

    // Both subtasks have no deps, so both set up on first tick
    wait_for_subtask_setups(&env, &[&first_id, &second_id]);

    // Complete both subtasks in parallel (both are independent, both eligible at once)
    complete_subtasks(&env, &[&first_id, &second_id]);

    // Subtasks are Done — they need to go through integration to become Archived.
    // Integration merges each subtask's branch to the parent's branch.
    // Parent advances only when ALL subtasks are Archived.

    // Pre-set parent's work output for when it advances
    env.set_output(
        &parent_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Parent work".into(),
        },
    );

    // Tick until both subtasks are Archived (integration complete)
    wait_for_archived(&env, &first_id);
    wait_for_archived(&env, &second_id);

    // Tick to trigger parent completion check + advancement
    for _ in 0..10 {
        env.tick();
        std::thread::sleep(Duration::from_millis(30));
        let parent = env.api().get_task(&parent_id).unwrap();
        if parent.current_stage() == Some("work") {
            break;
        }
    }

    // Parent should have advanced to the next stage after breakdown (work)
    let parent = env.api().get_task(&parent_id).unwrap();
    assert_eq!(
        parent.current_stage(),
        Some("work"),
        "Parent should advance to 'work' stage after all subtasks are Archived. Status: {:?}",
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

    let (_parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
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
    );

    let id_a = id_map.iter().find(|(t, _)| t == "Node A").unwrap().1.clone();
    let id_b = id_map.iter().find(|(t, _)| t == "Node B").unwrap().1.clone();
    let id_c = id_map.iter().find(|(t, _)| t == "Node C").unwrap().1.clone();
    let id_d = id_map.iter().find(|(t, _)| t == "Node D").unwrap().1.clone();

    // --- Phase 1: Only A gets set up (no deps) ---
    wait_for_subtask_setup(&env, &id_a);

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

    // B, C, D should all still be in SettingUp
    for id in [&id_b, &id_c, &id_d] {
        let task = env.api().get_task(id).unwrap();
        assert_eq!(
            task.phase,
            Phase::SettingUp,
            "Task {} should be in SettingUp",
            task.title
        );
    }

    // --- Phase 2: Complete A → B and C unblock ---
    complete_subtask(&env, &id_a);

    // Wait for B and C to set up (A is Done, their dep is satisfied)
    wait_for_subtask_setups(&env, &[&id_b, &id_c]);

    // B and C should be active
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

    // D should still be in SettingUp (B and C not done yet)
    let d = env.api().get_task(&id_d).unwrap();
    assert_eq!(
        d.phase,
        Phase::SettingUp,
        "D should still be in SettingUp (B,C not done)"
    );

    // --- Phase 3: Complete B and C in parallel → D unblocks ---
    complete_subtasks(&env, &[&id_b, &id_c]);

    // Wait for D to set up (B and C are Done, its deps are satisfied)
    wait_for_subtask_setup(&env, &id_d);

    // D should be active
    let d = env.api().get_task(&id_d).unwrap();
    assert!(
        d.status.is_active(),
        "D should be active after B and C done, got: {:?}",
        d.status
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
            content: "Technical design content".into(),
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

    let (_parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![SubtaskOutput {
            title: "Only task".into(),
            description: "Will fail".into(),
            depends_on: vec![],
        }],
    );

    let subtask_id = id_map[0].1.clone();

    // Wait for subtask setup (no deps, should set up on first tick)
    wait_for_subtask_setup(&env, &subtask_id);

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
    let parent = env.api().get_task(&_parent_id).unwrap();
    assert!(
        parent.is_failed(),
        "Parent should be Failed when subtask fails, got: {:?}",
        parent.status
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
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Beta".into(),
                description: "Second subtask".into(),
                depends_on: vec![],
            },
        ],
    );

    let alpha_id = id_map.iter().find(|(t, _)| t == "Alpha").unwrap().1.clone();
    let beta_id = id_map.iter().find(|(t, _)| t == "Beta").unwrap().1.clone();

    // Both have no deps, wait for both to set up
    wait_for_subtask_setups(&env, &[&alpha_id, &beta_id]);

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
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![SubtaskOutput {
            title: "Worker".into(),
            description: "Makes file changes".into(),
            depends_on: vec![],
        }],
    );

    let subtask_id = id_map[0].1.clone();
    wait_for_subtask_setup(&env, &subtask_id);

    // Write a file in the subtask's worktree (simulating agent making changes)
    let subtask = env.api().get_task(&subtask_id).unwrap();
    let wt_path = subtask.worktree_path.as_ref().unwrap();
    std::fs::write(
        Path::new(wt_path).join("feature.txt"),
        "implemented by subtask\n",
    )
    .expect("Should write file to subtask worktree");

    // Complete the subtask through work → review → Done
    complete_subtask(&env, &subtask_id);

    // Wait for integration → Archived
    wait_for_archived(&env, &subtask_id);

    let subtask = env.api().get_task(&subtask_id).unwrap();
    assert!(
        subtask.is_archived(),
        "Subtask should be Archived after integration, got: {:?}",
        subtask.status
    );

    // Verify the file was merged to the parent's branch:
    // The parent worktree should see the file (since the subtask merged to parent's branch)
    let parent = env.api().get_task(&parent_id).unwrap();
    let parent_wt = parent.worktree_path.as_ref().unwrap();

    // Pull the latest changes in the parent worktree (the merge was done via update-ref
    // on the branch, so we need to reset the worktree to pick up the new commits)
    let pull_output = std::process::Command::new("git")
        .args(["reset", "--hard", "HEAD"])
        .current_dir(parent_wt)
        .output()
        .expect("Should reset parent worktree");
    assert!(
        pull_output.status.success(),
        "git reset should succeed in parent worktree"
    );

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
fn test_subtask_integration_conflict() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let (_parent_id, id_map) = setup_parent_with_subtasks(
        &env,
        vec![
            SubtaskOutput {
                title: "Sub A".into(),
                description: "Edits shared file one way".into(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Sub B".into(),
                description: "Edits shared file another way".into(),
                depends_on: vec![],
            },
        ],
    );

    let id_a = id_map.iter().find(|(t, _)| t == "Sub A").unwrap().1.clone();
    let id_b = id_map.iter().find(|(t, _)| t == "Sub B").unwrap().1.clone();

    // Both have no deps, wait for setup
    wait_for_subtask_setups(&env, &[&id_a, &id_b]);

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
            },
        );
    }
    env.tick_until_settled();

    for id in [&id_a, &id_b] {
        let task = env.api().get_task(id).unwrap();
        assert_eq!(task.phase, Phase::AwaitingReview, "Subtask {id} should be AwaitingReview");
        env.api().approve(id).expect("Should approve work stage");
    }

    for id in [&id_a, &id_b] {
        env.set_output(
            id,
            MockAgentOutput::Artifact {
                name: "verdict".into(),
                content: "Looks good".into(),
            },
        );
    }
    env.tick_until_settled();

    // Integration order is nondeterministic — one will merge cleanly, the other
    // will conflict. Wait for whichever merges first.
    let (_merged_id, conflict_id) = wait_for_one_archived(&env, &id_a, &id_b);

    let conflict_task = env.api().get_task(conflict_id).unwrap();
    // Should be back in the work stage (recovery from integration failure)
    assert_eq!(
        conflict_task.current_stage(),
        Some("work"),
        "Conflicting subtask should be moved to recovery stage, got: {:?}",
        conflict_task.status
    );
    // Phase may be Idle (just assigned) or AgentWorking (orchestrator already started agent)
    assert!(
        conflict_task.phase == Phase::Idle || conflict_task.phase == Phase::AgentWorking,
        "Conflicting subtask should be Idle or AgentWorking after recovery, got: {:?}",
        conflict_task.phase
    );
    assert!(
        conflict_task.status.is_active(),
        "Conflicting subtask should be active after recovery, got: {:?}",
        conflict_task.status
    );
}
