---
name: e2e-testing
description: E2E testing strategy, philosophy, and infrastructure for orkestra-core
---

# E2E Testing: Strategy & Infrastructure

All e2e tests for orkestra-core live in `crates/orkestra-core/tests/e2e/`. They use a real SQLite database, a real orchestrator loop, and a `MockAgentRunner` (no actual CLI agents).

## Testing Philosophy

Every meaningful behavior must have an e2e test that exercises it through the orchestrator. Unit tests validate isolated components; e2e tests validate that the system actually works.

### The Cardinal Rule: Advance the Orchestrator

**Prefer `ctx.advance()` over any manual step advancement.** The orchestrator tick loop (`advance()`) is the real execution path — tasks progress because the orchestrator drives them, not because test code calls API methods in sequence.

The ONLY reason to skip `advance()` is when you need to **inject behavior mid-tick** (e.g., create a merge conflict between when a task reaches Done and when integration runs). Even then, use `advance()` for everything before and after the injection point.

**Why this matters:** The unmanly-topical-harrier failure happened because tests called `api.begin_pr_creation()` then `api.pr_creation_succeeded()` directly. The orchestrator never called `spawn_pr_creation()` from `tick()` — but the tests passed because they bypassed the orchestrator entirely. If the tests had used `advance()`, the dead code path would have been caught immediately.

**Bad:**
```rust
// Tests the API methods work, but NOT that the orchestrator drives them
api.begin_pr_creation(&task_id).unwrap();
api.pr_creation_succeeded(&task_id, "https://github.com/...").unwrap();
let task = api.get_task(&task_id).unwrap();
assert_eq!(task.status, Status::Archived);
```

**Good:**
```rust
// Tests that the orchestrator actually drives the PR creation flow
env.set_output(&task_id, MockAgentOutput::Artifact { ... });
env.advance(); // orchestrator spawns agent, processes output
env.advance(); // orchestrator drives the next step
// ... orchestrator handles PR creation as part of its tick loop
let task = env.api().get_task(&task_id).unwrap();
assert_eq!(task.status, Status::Archived);
```

### Mock Minimally

Mock only things that depend on external/remote services:
- **Mock**: Agent CLI invocations (Claude Code, OpenCode) → `MockAgentRunner`
- **Mock**: Title generation (calls LLM) → `MockTitleGenerator`
- **Mock**: Commit message generation (calls LLM) → `MockCommitMessageGenerator`
- **Mock**: PR creation (calls GitHub API) → `MockPrService`
- **Real**: SQLite database, git operations, worktrees, file I/O, orchestrator loop

If it runs locally and deterministically, use the real thing.

### Test Structure Pattern

Every e2e test should follow this pattern:

1. **Setup**: Create `TestEnv`, create task(s)
2. **Drive**: Set mock outputs → `advance()` → assert state → repeat
3. **Verify**: Assert on final state, prompt contents, iteration counts

```rust
#[test]
fn test_rejection_loops_back_to_work() {
    // 1. Setup
    let env = TestEnv::with_git(&workflow, &["worker", "reviewer"]);
    let task = env.create_task("Fix bug", "Fix it", None);

    // 2. Drive through work stage
    env.set_output(&task.id, MockAgentOutput::Artifact {
        name: "summary".into(),
        content: "Fixed the bug".into(),
        activity_log: None,
    });
    env.advance(); // spawns worker (completion ready)
    env.advance(); // processes work output → AwaitingReview

    // 3. Human approves work, advance to review
    env.api().approve(&task.id).unwrap();
    env.advance(); // advance to review stage

    // 4. Reviewer rejects
    env.set_output(&task.id, MockAgentOutput::Approval {
        decision: "reject".into(),
        content: "Missing error handling".into(),
        activity_log: None,
    });
    env.advance(); // spawns reviewer
    env.advance(); // processes rejection → back to work

    // 5. Verify
    let task = env.api().get_task(&task.id).unwrap();
    assert_eq!(task.current_stage(), Some("work"));
    assert_eq!(task.phase, Phase::Idle);

    // Verify the worker gets the rejection feedback in their prompt
    env.set_output(&task.id, MockAgentOutput::Artifact {
        name: "summary".into(),
        content: "Fixed with error handling".into(),
        activity_log: None,
    });
    env.advance(); // spawns worker with feedback
    let prompt = env.last_prompt();
    assert!(prompt.contains("Missing error handling"));
}
```

### What to Test

For every new feature or behavior:
1. **Happy path** — the feature works end-to-end through the orchestrator
2. **Rejection/retry path** — what happens when the reviewer rejects?
3. **Error path** — what happens on failure? Does the system recover?
4. **State transitions** — are the right phases/statuses reached at each step?
5. **Prompt injection** — does the agent receive the right context (artifacts, feedback, activity logs)?

### When to Write Unit vs E2E Tests

- **E2E test** (preferred): Any behavior that flows through the orchestrator, involves state transitions, or connects multiple components
- **Unit test**: Pure logic (parsers, validators, config loading, domain type methods)
- **Both**: Complex domain logic gets a unit test; its integration into the system gets an e2e test

### Test Naming Convention

Name tests after the behavior they verify, not the implementation:
- **Good**: `test_pr_creation_drives_through_orchestrator_tick`
- **Good**: `test_rejection_sends_feedback_to_worker`
- **Bad**: `test_spawn_pr_creation_method`
- **Bad**: `test_api_calls_work`

---

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
| `env.set_output_with_activity(task_id, output)` | Same but simulates agent activity (LogLine events). Sets `has_activity=true` in the database. Use this when testing session resumption or anything that checks `has_activity`. |
| `env.set_failure_with_activity(task_id, error)` | Simulates an infrastructure crash with prior streaming output. Routes through `fail_execution` — does **not** call `persist_activity_flag`, so `has_activity` stays `false`. Use only to test crash-recovery scenarios, not structured failure with activity. To test "agent produced output then returned `StageOutput::Failed`", use `set_output_with_activity(task_id, MockAgentOutput::Failed { error: ... })` instead. |
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
            depends_on: vec![],
        },
        SubtaskOutput {
            title: "Implement handler".into(),
            description: "Add the request handler".into(),
            detailed_instructions: "Full implementation brief...".into(),
            depends_on: vec![0], // Depends on subtask at index 0
        },
    ],
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
            .with_prompt("worker.md"),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
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
| `workflow.rs` | Full stage pipelines, approval/rejection loops, questions, flows, gate scripts, interrupt/resume |
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
env.api().approve(&task.id).unwrap();

// Reject with feedback
env.api().reject(&task.id, "Needs error handling").unwrap();

// Answer questions
env.api().answer_questions(&task.id, vec![
    QuestionAnswer { question_id: "q1".into(), answer: "oauth".into() },
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
