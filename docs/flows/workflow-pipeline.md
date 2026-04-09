# Flow: Workflow Pipeline

How a Trak progresses through a sequence of stages — stage types, capabilities, phase transitions, output routing, and failure/rejection loops.

This doc describes the **generic workflow engine mechanics**. It is independent of any specific project's stage names or pipeline configuration. For code-level internals of how a single stage spawns and executes, see [stage-execution.md](stage-execution.md).

## Core Concepts

A **workflow** is an ordered list of stages. A **Trak** moves through stages left to right. Each stage produces a named **artifact**. Stages are **agent stages** (spawn an AI agent). Some agent stages have an optional **gate script** (a shell command that runs after the agent completes). **Capabilities** on a stage control what output types are valid and how routing works.

```
stage_A → stage_B → stage_C → Done
```

A Trak is always in exactly one stage, tracked by `task.status = Active(stage_name)`.

## Stage Types

### Agent Stages

Spawn an AI agent (Claude Code, OpenCode, etc.). The agent receives a prompt with Trak context and produces structured JSON output. The output type determines what happens next.

**Possible agent outputs:**
- **Artifact** — Content for this stage's artifact. Advances to next stage (or pauses for review).
- **Questions** — Clarifying questions for the human. Trak pauses until answered.
- **Subtraks** — Breakdown into child Traks. Trak pauses until approved, then children execute.
- **Approval** (approve) — Stage approves the work. Advances to next stage.
- **Approval** (reject) — Stage rejects the work. Routes to the `rejection_stage`.
- **Failed** — Agent declares it cannot complete the work. Trak is marked failed.
- **Blocked** — Agent declares it is blocked on something external. Trak is marked blocked.

### Gate Scripts

Some agent stages have an optional **gate script** — a shell command (e.g., `cargo test`, `npm run lint`) that runs after the agent completes successfully. Binary outcome:
- **Exit 0** — Gate passed. Trak advances to the next stage.
- **Non-zero exit** — Gate failed. The agent is re-queued with the script's error output as feedback. Routes to `on_failure` stage if configured; otherwise Trak fails permanently.

Gate scripts never pause for review, never produce questions or Subtraks.

## Phase Lifecycle

A Trak's **phase** tracks its moment-to-moment execution state within a stage. This is separate from which stage it's in.

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

**Key sequence**: When an agent produces output, the Trak either:
1. **Auto-advances** → `Finishing` → `Committing` → `Finished` → `Idle` at next stage
2. **Pauses for review** → `AwaitingReview` (human must approve/reject/answer)

Whether a stage auto-advances depends on `is_automated`, `auto_mode`, and the output type.

## Capabilities

Capabilities are flags on a `StageConfig` that control what the agent can output and how routing works.

### `ask_questions: true`

Agent can output questions instead of an artifact. When it does:
- Trak enters `AwaitingReview` with questions displayed to the human
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

**On approve**: Artifact is stored, Trak advances to next stage (same as plain artifact).

**On reject**: Trak routes to `rejection_stage`. If `rejection_stage` is not configured, defaults to the previous stage in the pipeline.

**`reset_session`**: When true, the target stage starts a completely new agent session (full initial prompt). When false, the existing session is resumed with rejection feedback.

**Human confirmation**: If the stage is not automated (`is_automated: false`), rejections pause in `AwaitingReview` for human confirmation before executing. The human can:
- **Approve** (confirm) — Rejection executes, Trak routes to `rejection_stage`
- **Reject** (override) — Rejection is overridden, Trak stays in current stage with a new iteration

### `subtasks`

Agent can output a breakdown into Subtraks.

```yaml
capabilities:
  subtasks:
    flow: hotfix             # Flow assigned to child Traks (optional)
    completion_stage: check  # Where parent resumes after children finish (optional)
```

When Subtraks are approved:
- Child Traks are created with dependencies
- Parent enters `WaitingOnChildren`
- When all children complete, parent advances to `completion_stage` (or the default next stage)

See [subtask-lifecycle.md](subtask-lifecycle.md) for details.

## Routing on Failure and Rejection

### Gate failure with `on_failure`

```
stage_A(gate, on_failure: stage_B) ──[exit non-zero]──→ stage_B
```

- Current iteration ends with `GateFailed` outcome
- New iteration created at `stage_B` with a `GateFailure` trigger
- The `stage_B` agent receives the gate script's error output as feedback in a resume prompt
- If `stage_B` was previously active in this Trak, the **same session is resumed**

Without `on_failure`, the Trak is permanently failed.

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
| Gate fails → recovery stage | **Resume** existing session at recovery stage |
| Agent rejects → rejection stage (`reset_session: false`) | **Resume** existing session at target |
| Agent rejects → rejection stage (`reset_session: true`) | **New** session at target |
| Human rejects → same stage retry | **Resume** existing session |
| Human answers questions → same stage | **Resume** existing session |
| Trak interrupted → resumed | **Resume** existing session |

**Resume prompt vs full prompt**: On first spawn, the agent gets a full prompt (all artifacts, activity logs, Trak context). On resume, it gets a short prompt with just the new context (feedback, answers, error). The agent already has the full context in its session history.

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

Gate failures create iterations too. A gate fail + recovery creates:
```
check iteration #1 → gate_failed
work iteration #2  → (resumed with error feedback)
check iteration #2 → passed
```

## Auto-Advance Rules

A stage auto-advances (skips `AwaitingReview`) when **any** of these are true:
- The stage has `is_automated: true`
- The Trak has `auto_mode: true`
- The stage's gate script passed (gate scripts always auto-advance on success)

When a stage does NOT auto-advance, it enters `AwaitingReview` and waits for a human action:
- `approve()` — Advance to next stage
- `reject(feedback)` — Retry current stage with feedback
- `answer_questions(answers)` — Resume agent with answers (questions output only)

## Flows (Alternate Pipelines)

A flow defines a subset of the global stage list. Traks assigned to a flow only traverse that flow's stages.

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

Flows can **override** stage config (prompt, capabilities, model, disallowed_tools) per stage. Overrides are full replacement, not merge.

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
               Artifact          Questions          Subtraks          Approval
                    │                  │                 │            ┌────┴────┐
                    │                  │                 │         approve    reject
                    │                  │                 │            │         │
              auto-advance?      AwaitingReview    AwaitingReview    │    rejection_
                 ┌──┴──┐          (answers)         (approve)       │    stage
                yes    no              │                 │            │         │
                 │      │         human answers    human approves     │    ┌────┴────┐
                 │  AwaitingReview      │          create Subtraks    │  auto?   AwaitingReview
                 │   (approve)    resume agent     WaitOnChildren     │    │    (confirm/override)
                 │      │              │                 │            │    │         │
                 │  human approves     │          children done       │    │    confirm: execute
                 │      │              │                 │            │    │    override: retry stage
                 ▼      ▼              ▼                 ▼            ▼    ▼
            ┌────────────────────────────────────────────────────────────────┐
            │                    Next stage (or Done)                        │
            └────────────────────────────────────────────────────────────────┘

Gate scripts (attached to agent stages):

              ┌──────────────────┐
              │  Gate script runs │
              └───────┬──────────┘
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
