//! End-to-end tests for the resource lifecycle.
//!
//! Tests that resources registered by agents in one stage are:
//! - Persisted on the task's `resources` store
//! - Included inline in the agent prompt via the `{{#each resources}}` loop
//! - Inherited by subtasks from their parent task (merged into inline list)
//! - Upserted correctly when a stage re-runs (name collision → newer URL wins)

use orkestra_core::workflow::config::{GateConfig, IntegrationConfig, StageConfig, WorkflowConfig};
use orkestra_core::workflow::execution::{ResourceOutput, SubtaskOutput};

use crate::helpers::{workflows, MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

/// Build a simple two-stage workflow (planning → work).
///
/// Planning has `GateConfig::Agentic` so it pauses for human approval before advancing.
fn two_stage_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ])
    .with_integration(IntegrationConfig::new("work"))
}

// =============================================================================
// Test 1: Resources persist from planning to work stage
// =============================================================================

/// Verify that resources produced by planning appear inline in the work stage prompt.
#[test]
fn test_resources_persist_across_stages() {
    let workflow = two_stage_workflow();
    let env = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = env.create_task("Blog post feature", "Write the blog post", None);
    let task_id = task.id.clone();

    // Planning stage: produce a plan + register a resource
    env.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan for the blog post".into(),
            activity_log: None,
            resources: vec![ResourceOutput {
                name: "blog-doc".to_string(),
                url: Some("https://docs.google.com/blog-draft".to_string()),
                description: Some("Draft blog post document".to_string()),
            }],
        },
    );
    env.advance(); // spawns planner (completion ready)
    env.advance(); // processes plan output, persists resource

    // Approve planning stage
    env.api().approve(&task_id).unwrap();
    env.advance(); // commit pipeline → advance to work stage

    // Verify task.resources was populated
    let task = env.api().get_task(&task_id).unwrap();
    assert_eq!(task.resources.len(), 1);
    let resource = task
        .resources
        .get("blog-doc")
        .expect("blog-doc resource should exist");
    assert_eq!(
        resource.url.as_deref(),
        Some("https://docs.google.com/blog-draft")
    );
    assert_eq!(
        resource.description.as_deref(),
        Some("Draft blog post document")
    );

    // Verify task is now in work stage
    assert_eq!(task.current_stage(), Some("work"));

    // Set work output so the spawn doesn't hang
    env.set_output(&task_id, MockAgentOutput::artifact("summary", "Work done"));
    env.advance(); // spawns work agent

    // Verify the work stage prompt contains inline resource info
    let prompt = env.last_prompt_for(&task_id);
    assert!(
        prompt.contains("blog-doc"),
        "Work stage prompt should contain resource name. Got prompt:\n{prompt}"
    );
    assert!(
        prompt.contains("https://docs.google.com/blog-draft"),
        "Work stage prompt should contain resource URL. Got prompt:\n{prompt}"
    );
}

// =============================================================================
// Test 2: Subtask sees parent resources
// =============================================================================

/// Verify that a subtask's prompt includes resources from the parent task inline.
#[test]
fn test_subtask_sees_parent_resources() {
    let workflow = workflows::with_subtasks();
    let env = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let parent = env.create_task("Feature with resources", "Build feature", None);
    let parent_id = parent.id.clone();

    // Planning: produce plan + register a resource
    env.set_output(
        &parent_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan content".into(),
            activity_log: None,
            resources: vec![ResourceOutput {
                name: "parent-doc".to_string(),
                url: Some("https://parent.example.com/doc".to_string()),
                description: None,
            }],
        },
    );
    env.advance(); // spawn planner
    env.advance(); // process plan
    env.api().approve(&parent_id).unwrap();
    env.advance(); // advance to breakdown

    // Breakdown: produce two subtasks (single-subtask output is inlined, not a child Task)
    env.set_output(
        &parent_id,
        MockAgentOutput::Subtasks {
            content: "Technical design".into(),
            subtasks: vec![
                SubtaskOutput {
                    title: "Implement feature".to_string(),
                    description: "Do the work".to_string(),
                    detailed_instructions: "Implement the feature".to_string(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Write tests".to_string(),
                    description: "Add test coverage".to_string(),
                    detailed_instructions: "Write tests for the feature".to_string(),
                    depends_on: vec![0],
                },
            ],
            activity_log: None,
            resources: vec![],
        },
    );
    env.advance(); // spawn breakdown agent
    env.advance(); // process breakdown output
    env.api().approve(&parent_id).unwrap();
    env.advance(); // commit pipeline → creates subtasks (multi-subtask path)

    // Get the created subtasks (depends_on=[0] means subtask[1] waits for subtask[0])
    let subtasks = env.api().list_subtasks(&parent_id).unwrap();
    assert_eq!(subtasks.len(), 2, "Should have two subtasks");

    // Find the independent subtask (no dependencies) — it will be set up first
    let subtask = subtasks
        .iter()
        .find(|s| s.depends_on.is_empty())
        .expect("Should have an independent subtask");
    let subtask_id = subtask.id.clone();

    // Subtask setup: advance once to trigger setup_awaiting_tasks → worktree creation
    env.advance();

    // Queue subtask work output so the spawn doesn't stall
    env.set_output(
        &subtask_id,
        MockAgentOutput::artifact("summary", "Subtask work done"),
    );
    env.advance(); // spawns subtask work agent — prompt should contain parent resources

    // Verify the subtask prompt contains the parent's resource inline
    let subtask_prompt = env.last_prompt_for(&subtask_id);
    assert!(
        subtask_prompt.contains("parent-doc"),
        "Subtask prompt should contain parent's resource name. Got prompt:\n{subtask_prompt}"
    );
    assert!(
        subtask_prompt.contains("https://parent.example.com/doc"),
        "Subtask prompt should contain parent's resource URL. Got prompt:\n{subtask_prompt}"
    );
}

// =============================================================================
// Test 3: Resource upsert — newer iteration wins on name collision
// =============================================================================

/// Verify that when a stage re-runs (after rejection), a resource with the same
/// name from the new iteration replaces the one from the previous iteration.
#[test]
fn test_resource_upsert_on_rejection_retry() {
    let workflow = two_stage_workflow();
    let env = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = env.create_task("Upsert test", "Test resource upsert", None);
    let task_id = task.id.clone();

    // Planning stage: produce plan + register resource v1
    env.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Initial plan".into(),
            activity_log: None,
            resources: vec![ResourceOutput {
                name: "doc".to_string(),
                url: Some("https://example.com/v1".to_string()),
                description: None,
            }],
        },
    );
    env.advance(); // spawn planner
    env.advance(); // process plan (resource v1 persisted)

    // Verify v1 is stored
    let task = env.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.resources.get("doc").and_then(|r| r.url.as_deref()),
        Some("https://example.com/v1")
    );

    // Restart planning stage — agent will re-run
    env.api()
        .restart_stage(&task_id, "Need a better plan")
        .expect("Should restart_stage");

    // Planning stage retry: produce plan + register resource v2 (same name)
    env.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Improved plan".into(),
            activity_log: None,
            resources: vec![ResourceOutput {
                name: "doc".to_string(),
                url: Some("https://example.com/v2".to_string()),
                description: Some("Updated document".to_string()),
            }],
        },
    );
    env.advance(); // spawn planner again
    env.advance(); // process plan (resource v2 upserts v1)

    // Verify v2 replaced v1 (upsert semantics)
    let task = env.api().get_task(&task_id).unwrap();
    let resource = task
        .resources
        .get("doc")
        .expect("resource 'doc' should exist");
    assert_eq!(
        resource.url.as_deref(),
        Some("https://example.com/v2"),
        "Resource URL should be updated to v2 after upsert"
    );
    assert_eq!(
        resource.description.as_deref(),
        Some("Updated document"),
        "Resource description should be updated"
    );

    // Verify only one resource exists (not duplicated)
    assert_eq!(
        task.resources.len(),
        1,
        "Should have exactly one resource after upsert"
    );
}

// =============================================================================
// Test 4: Description-only resource renders without URL
// =============================================================================

/// Verify that a resource with `url: None` renders as `**name** — description`
/// in the work stage prompt, without empty backtick-wrapped content.
#[test]
fn test_description_only_resource_renders_without_url() {
    let workflow = two_stage_workflow();
    let env = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = env.create_task("Notes feature", "Use notes as resources", None);
    let task_id = task.id.clone();

    // Planning stage: produce a plan + register a description-only resource (no URL)
    env.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan for the feature".into(),
            activity_log: None,
            resources: vec![ResourceOutput {
                name: "implementation-note".to_string(),
                url: None,
                description: Some("Key implementation decision: use feature flags".to_string()),
            }],
        },
    );
    env.advance(); // spawns planner
    env.advance(); // processes plan output, persists resource

    // Approve planning stage
    env.api().approve(&task_id).unwrap();
    env.advance(); // commit pipeline → advance to work stage

    // Verify resource was persisted with no URL
    let task = env.api().get_task(&task_id).unwrap();
    let resource = task
        .resources
        .get("implementation-note")
        .expect("implementation-note resource should exist");
    assert!(resource.url.is_none(), "Resource URL should be None");
    assert_eq!(
        resource.description.as_deref(),
        Some("Key implementation decision: use feature flags")
    );

    // Set work output so the spawn doesn't hang
    env.set_output(&task_id, MockAgentOutput::artifact("summary", "Work done"));
    env.advance(); // spawns work agent

    // Verify the work stage prompt contains the resource name and description
    let prompt = env.last_prompt_for(&task_id);
    assert!(
        prompt.contains("implementation-note"),
        "Work stage prompt should contain resource name. Got prompt:\n{prompt}"
    );
    assert!(
        prompt.contains("Key implementation decision: use feature flags"),
        "Work stage prompt should contain resource description. Got prompt:\n{prompt}"
    );
    // Must NOT contain backtick-wrapped empty URL
    assert!(
        !prompt.contains("`: `"),
        "Work stage prompt should not have empty backtick-wrapped URL. Got prompt:\n{prompt}"
    );
}
