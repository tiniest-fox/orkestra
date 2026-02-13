# Flow: Workflow Pipeline

How a task progresses through a sequence of stages — stage types, capabilities, phase transitions, output routing, and failure/rejection loops.

This doc describes the **generic workflow engine mechanics**. It is independent of any specific project's stage names or pipeline configuration. For code-level internals of how a single stage spawns and executes, see [stage-execution.md](stage-execution.md).

## Core Concepts

A **workflow** is an ordered list of stages. A **task** moves through stages left to right. Each stage produces a named **artifact**. Stages can be **agent stages** (spawn an AI agent) or **script stages** (run a shell command). **Capabilities** on a stage control what output types are valid and how routing works.

```
stage_A → stage_B → stage_C → Done
```

A task is always in exactly one stage, tracked by `task.status = Active(stage_name)`.

## Stage Types

### Agent Stages

Spawn an AI agent (Claude Code, OpenCode, etc.). The agent receives a prompt with task context and produces structured JSON output. The output type determines what happens next.

**Possible agent outputs:**
- **Artifact** — Content for this stage's artifact. Advances to next stage (or pauses for review).
- **Questions** — Clarifying questions for the human. Task pauses until answered.
- **Subtasks** — Breakdown into child tasks. Task pauses until approved, then children execute.
- **Approval** (approve) — Stage approves the work. Advances to next stage.
- **Approval** (reject) — Stage rejects the work. Routes to the `rejection_stage`.
- **Failed** — Agent declares it cannot complete the work. Task is marked failed.
- **Blocked** — Agent declares it is blocked on something external. Task is marked blocked.

### Script Stages

Run a shell command (e.g., `cargo test`, `npm run lint`). No agent, no prompt. Binary outcome:
- **Exit 0** — Script output stored as artifact. Always auto-advances to next stage.
- **Non-zero exit** — Routes to `on_failure` stage if configured. Otherwise task fails permanently.

Script stages never pause for review, never produce questions or subtasks.

## Phase Lifecycle

A task's **phase** tracks its moment-to-moment execution state within a stage. This is separate from which stage it's in.

```
Idle → AgentWorking → AwaitingReview → Finishing → Committing → Finished → Idle (next stage)
              │                              │
              └── Interrupted ───────────────┘ (resume)
```

| Phase | Meaning |
|-------|---------|
| `Idle` | Ready for the orchestrator to start execution |
| `AgentWorking` | Agent or script is running |
| `AwaitingReview` | Output produced, waiting for human action (approve/reject/answer) |
| `Finishing` | Output approved, entering commit pipeline |
| `Committing` | Commit in progress |
| `Finished` | Commit complete, ready for stage advancement |
| `Interrupted` | Human interrupted the agent mid-execution |

**Key sequence**: When an agent produces output, the task either:
1. **Auto-advances** → `Finishing` → `Committing` → `Finished` → `Idle` at next stage
2. **Pauses for review** → `AwaitingReview` (human must approve/reject/answer)

Whether a stage auto-advances depends on `is_automated`, `auto_mode`, and the output type.

## Capabilities

Capabilities are flags on a `StageConfig` that control what the agent can output and how routing works.

### `ask_questions: true`

Agent can output questions instead of an artifact. When it does:
- Task enters `AwaitingReview` with questions displayed to the human
- Human answers → agent session is **resumed** with the answers
- Agent can then produce its artifact (or ask more questions)

### `approval`

Agent must produce an approve/reject decision instead of a plain artifact.

```yaml
capabilities:
  approval:
    rejection_stage: work    # Where to go on reject (optional)
    reset_session: true      # Start fresh session at target (optional)
```

**On approve**: Artifact is stored, task advances to next stage (same as plain artifact).

**On reject**: Task routes to `rejection_stage`. If `rejection_stage` is not configured, defaults to the previous stage in the pipeline.

**`reset_session`**: When true, the target stage starts a completely new agent session (full initial prompt). When false, the existing session is resumed with rejection feedback.

**Human confirmation**: If the stage is not automated (`is_automated: false`), rejections pause in `AwaitingReview` for human confirmation before executing. The human can:
- **Approve** (confirm) — Rejection executes, task routes to `rejection_stage`
- **Reject** (override) — Rejection is overridden, task stays in current stage with a new iteration

### `subtasks`

Agent can output a breakdown into subtasks.

```yaml
capabilities:
  subtasks:
    flow: hotfix             # Flow assigned to child tasks (optional)
    completion_stage: check  # Where parent resumes after children finish (optional)
```

When subtasks are approved:
- Child tasks are created with dependencies
- Parent enters `WaitingOnChildren`
- When all children complete, parent advances to `completion_stage` (or the default next stage)

See [subtask-lifecycle.md](subtask-lifecycle.md) for details.

## Routing on Failure and Rejection

### Script failure with `on_failure`

```
stage_A(script, on_failure: stage_B) ──[exit non-zero]──→ stage_B
```

- Current iteration ends with `ScriptFailed` outcome
- New iteration created at `stage_B` with a `ScriptFailure` trigger
- The `stage_B` agent receives the script's error output as feedback in a resume prompt
- If `stage_B` was previously active in this task, the **same session is resumed**

Without `on_failure`, the task is permanently failed.

### Agent rejection with `rejection_stage`

```
stage_C(approval, rejection_stage: stage_A) ──[reject]──→ stage_A
```

- Current iteration ends with `Rejection` outcome
- New iteration created at `stage_A` with a `Rejection` trigger
- The `stage_A` agent receives the rejection feedback
- If `reset_session: true`, a new session starts (full prompt). Otherwise the existing session is resumed.

### Human rejection (via `reject()` API)

```
[any stage in AwaitingReview] ──[human rejects]──→ same stage (new iteration)
```

- Human rejection always retries the **current stage** (does not route elsewhere)
- A new iteration is created with a `Feedback` trigger
- The existing session is resumed with the human's feedback text

## Session Continuity

Each agent stage maintains a **session** (a persistent conversation with the AI agent). Understanding when sessions persist vs reset is critical:

| Transition | Session Behavior |
|-----------|-----------------|
| Agent produces artifact → next stage | New session at next stage |
| Script fails → recovery stage | **Resume** existing session at recovery stage |
| Agent rejects → rejection stage (`reset_session: false`) | **Resume** existing session at target |
| Agent rejects → rejection stage (`reset_session: true`) | **New** session at target |
| Human rejects → same stage retry | **Resume** existing session |
| Human answers questions → same stage | **Resume** existing session |
| Task interrupted → resumed | **Resume** existing session |

**Resume prompt vs full prompt**: On first spawn, the agent gets a full prompt (all artifacts, activity logs, task context). On resume, it gets a short prompt with just the new context (feedback, answers, error). The agent already has the full context in its session history.

Exception: `Recheck` resumes (stage re-entry after upstream stages re-ran) re-inject artifacts since the agent may have stale versions.

## Iteration Numbering

Each run of a stage creates an **iteration**, numbered per stage starting from 1.

```
stage_A iteration #1 → approved
stage_B iteration #1 → approved
stage_C iteration #1 → rejected → routes to stage_B
stage_B iteration #2 → approved (resume or fresh, depending on reset_session)
stage_C iteration #2 → approved
```

Script stages create iterations too. A script fail + recovery creates:
```
check iteration #1 → script_failed
work iteration #2  → (resumed with error feedback)
check iteration #2 → passed
```

## Auto-Advance Rules

A stage auto-advances (skips `AwaitingReview`) when **any** of these are true:
- The stage has `is_automated: true`
- The task has `auto_mode: true`
- The output is from a script stage (scripts always auto-advance on success)

When a stage does NOT auto-advance, it enters `AwaitingReview` and waits for a human action:
- `approve()` — Advance to next stage
- `reject(feedback)` — Retry current stage with feedback
- `answer_questions(answers)` — Resume agent with answers (questions output only)

## Flows (Alternate Pipelines)

A flow defines a subset of the global stage list. Tasks assigned to a flow only traverse that flow's stages.

```yaml
# Global stages: plan → task → work → check → review → compound

flows:
  quick:
    stages: [plan, work, check, review, compound]   # skips task
  hotfix:
    stages: [work, check, review]                    # skips plan, task, compound
  micro:
    stages: [work, check]                            # work + checks only
```

Flows can **override** stage config (prompt, capabilities, inputs, model, disallowed_tools) per stage. Overrides are full replacement, not merge.

Key constraint: `rejection_stage` and `on_failure` targets must exist within the flow's stage list.

## Complete State Machine

Combining all transitions:

```
                        ┌─────────────────────────────────────────┐
                        │          Agent produces output          │
                        └──────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────┬┴────────────────┬──────────────────┐
                    ▼                  ▼                 ▼                  ▼
               Artifact          Questions          Subtasks          Approval
                    │                  │                 │            ┌────┴────┐
                    │                  │                 │         approve    reject
                    │                  │                 │            │         │
              auto-advance?      AwaitingReview    AwaitingReview    │    rejection_
                 ┌──┴──┐          (answers)         (approve)       │    stage
                yes    no              │                 │            │         │
                 │      │         human answers    human approves     │    ┌────┴────┐
                 │  AwaitingReview      │          create subtasks    │  auto?   AwaitingReview
                 │   (approve)    resume agent     WaitOnChildren     │    │    (confirm/override)
                 │      │              │                 │            │    │         │
                 │  human approves     │          children done       │    │    confirm: execute
                 │      │              │                 │            │    │    override: retry stage
                 ▼      ▼              ▼                 ▼            ▼    ▼
            ┌────────────────────────────────────────────────────────────────┐
            │                    Next stage (or Done)                        │
            └────────────────────────────────────────────────────────────────┘

Script stages:

              ┌──────────────┐
              │  Script runs  │
              └──────┬───────┘
                 ┌───┴───┐
              exit 0   non-zero
                 │         │
           auto-advance  on_failure?
                 │      ┌──┴──┐
                 │    yes     no
                 │      │      │
                 │  recovery  FAILED
                 │   stage
                 ▼      ▼
            Next stage  Recovery stage
                        (agent resumed
                         with error)
```
