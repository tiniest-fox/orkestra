---
name: e2e-testing
description: E2E test infrastructure for orkestra-core — TestEnv, MockAgentOutput, workflow builders
---

# E2E Testing Infrastructure

All e2e tests for orkestra-core live in `crates/orkestra-core/tests/e2e/`. They use a real SQLite database, a real orchestrator loop, and a `MockAgentRunner` (no actual CLI agents).

## Running Tests

```bash
# All core tests (unit + e2e)
cargo test -p orkestra-core

# Only e2e tests
cargo test -p orkestra-core --test e2e

# Single test by name
cargo test -p orkestra-core --test e2e test_name_here
```

## TestEnv — The Unified Test Environment

`TestEnv` is the entry point for all e2e tests. It wires up SQLite, an orchestrator, and mock agent execution.

### Two Constructors

| Constructor | Use When | Git Support |
|-------------|----------|-------------|
| `TestEnv::with_workflow(wf)` | Script-only tests, cleanup tests | No git repo |
| `TestEnv::with_git(wf, agents)` | Agent tests needing worktrees and prompts | Real git repo + prompt files |

```rust
// Script-only (no git)
let env = TestEnv::with_workflow(workflows::sleep_script());

// Agent tests (real git, creates .orkestra/agents/{name}.md for each agent)
let env = TestEnv::with_git(&workflows::with_subtasks(), &["planner", "breakdown", "worker", "reviewer"]);
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `env.create_task(title, desc, base_branch)` | Creates task + runs setup synchronously. Returns task in Idle phase. |
| `env.create_subtask(parent_id, title, desc)` | Creates subtask + runs setup synchronously. |
| `env.advance()` | Single orchestrator tick. Deterministic with mock agents. |
| `env.tick()` | Same as advance (alias). |
| `env.tick_until(predicate, timeout, context)` | Tick until predicate returns true or timeout. |
| `env.api()` | Get `MutexGuard<WorkflowApi>` for human actions (approve, reject, answer). |
| `env.set_output(task_id, output)` | Set mock output for next agent spawn on this task. |
| `env.set_output_with_activity(task_id, output)` | Same but simulates agent activity (LogLine events). |
| `env.last_prompt()` | Get the combined system+user prompt from the last agent call. |
| `env.last_prompt_for(task_id)` | Get the last prompt sent to a specific task's agent. |
| `env.last_run_config()` | Get the full `RunConfig` from the last call. |
| `env.call_count()` | Number of agent spawn calls so far. |
| `env.repo_path()` | Path to the temp directory / git repo. |

### Typical Test Flow

```rust
#[test]
fn test_worker_receives_plan_artifact() {
    let wf = workflows::with_subtasks();
    let env = TestEnv::with_git(&wf, &["planner", "breakdown", "worker", "reviewer"]);

    // Create task
    let task = env.create_task("Fix bug", "Fix the login bug", None);

    // Planning stage: set output, advance to process it
    env.set_output(&task.id, MockAgentOutput::Artifact {
        name: "plan".into(),
        content: "## Plan\nFix the login validation".into(),
        activity_log: None,
    });
    env.advance(); // Spawns planner
    env.advance(); // Processes planner output, moves to breakdown

    // Verify the breakdown agent received the plan
    let prompt = env.last_prompt();
    assert!(prompt.contains("Fix the login validation"));
}
```

## MockAgentOutput — Building Agent Responses

```rust
// Questions (clarifying questions from agent)
MockAgentOutput::Questions(vec![
    Question {
        id: "q1".into(),
        text: "Which auth provider?".into(),
        options: vec![
            QuestionOption { label: "OAuth".into(), value: "oauth".into() },
            QuestionOption { label: "JWT".into(), value: "jwt".into() },
        ],
    },
])

// Artifact (plan, summary, verdict, etc.)
MockAgentOutput::Artifact {
    name: "plan".into(),       // Must match stage's artifact name
    content: "The plan content".into(),
    activity_log: None,        // Optional implementation notes
}

// Approval (reviewer stage)
MockAgentOutput::Approval {
    decision: "approve".into(), // "approve" or "reject"
    content: "LGTM".into(),
    activity_log: None,
}

// Subtasks (breakdown stage)
MockAgentOutput::Subtasks {
    content: "Technical design".into(),
    subtasks: vec![
        SubtaskOutput {
            title: "Add migration".into(),
            description: "Create the SQL migration".into(),
            detailed_instructions: "Full implementation brief...".into(),
            dependencies: vec![],
        },
        SubtaskOutput {
            title: "Implement handler".into(),
            description: "Add the request handler".into(),
            detailed_instructions: "Full implementation brief...".into(),
            dependencies: vec![0], // Depends on subtask at index 0
        },
    ],
    skip_reason: None,
    activity_log: None,
}

// Failed
MockAgentOutput::Failed { error: "Could not parse config".into() }

// Blocked
MockAgentOutput::Blocked { reason: "Missing API key".into() }
```

## Pre-Built Workflow Configs

Import from `helpers::workflows`:

| Builder | Stages | Use For |
|---------|--------|---------|
| `workflows::sleep_script()` | `work` (sleep 60) | Process killing tests — never completes on its own |
| `workflows::with_subtasks()` | plan → breakdown → work → review + `subtask` flow | Full pipeline tests with subtask support |
| `workflows::instant_script()` | `work` (echo hello) | Stale PID tests — completes instantly |

### Building Custom Workflows

```rust
use orkestra_core::workflow::config::*;

let workflow = WorkflowConfig {
    version: 1,
    stages: vec![
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_inputs(vec!["plan".into()]),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_inputs(vec!["summary".into()])
            .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
            .automated(),
    ],
    integration: IntegrationConfig::default(),
    flows: indexmap::IndexMap::new(),
};
```

## Test File Organization

| File | Covers |
|------|--------|
| `workflow.rs` | Full stage pipelines, approval/rejection loops, questions, flows, script stages, interrupt/resume |
| `subtasks.rs` | Subtask creation, dependencies, parent advancement, integration |
| `task_creation.rs` | Task setup, worktree creation, title generation, base branch handling |
| `startup.rs` | Startup recovery (stale PIDs, orphaned worktrees, stuck integrations) |
| `cleanup.rs` | Process killing, zombie cleanup |
| `multi_project.rs` | Multiple projects sharing a database |
| `assistant.rs` | Assistant chat sessions |

## Human Actions in Tests

Use `env.api()` to get the API lock, then call methods:

```rust
// Approve current stage
env.api().approve_task(&task.id).unwrap();

// Reject with feedback
env.api().reject_task(&task.id, "Needs error handling").unwrap();

// Answer questions
env.api().answer_questions(&task.id, &[
    ("q1".into(), "oauth".into()),
]).unwrap();
```

## Prompt Verification Helpers

```rust
// Assert last prompt is a full prompt (not resume) for a given artifact
env.assert_full_prompt("plan", /*can_ask_questions=*/true, /*has_approval=*/false);

// Assert last prompt is a resume prompt with expected type and content
env.assert_resume_prompt_contains("rejection", &["Needs error handling"]);
```

## Reference Files

| File | Role |
|------|------|
| `tests/e2e/helpers.rs` | `TestEnv`, `MockAgentOutput`, workflow builders, process helpers |
| `tests/e2e/workflow.rs` | Largest test file — full pipeline tests |
| `tests/e2e/subtasks.rs` | Subtask lifecycle tests |
| `tests/e2e/helpers/` | (empty currently — all helpers in `helpers.rs`) |
