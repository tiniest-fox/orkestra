# Auto-Intervention System for Unproductive Loops

## Context

Orkestra agents can get stuck in unproductive loops with no retry limit. The `quizzically-lush-tahr` task demonstrated this: 8+ work iterations and 6+ check iterations over ~4 hours, the agent repeatedly seeing the same errors but unable to break out of the cycle. The accumulated context in the agent's session can actually make things worse — the agent gets confused by its own earlier failed attempts.

This happens in two common patterns:
- **Script failure loops**: work → checks (script fails) → work → checks → ... endlessly
- **Rejection loops**: work → review (rejects) → work → review → ... endlessly

**Important nuance**: not all repeated iterations are unproductive. A reviewer might legitimately reject multiple times because each pass finds real improvements to make — the agent is making forward progress, just not done yet. The system must distinguish "stuck in a rut" from "iterating productively" and avoid interrupting productive work.

**Rejection loops involve two agents.** Unlike script failure loops (where the worker is clearly the problem), rejection loops have a worker *and* a reviewer. The diagnostic agent must determine which one is at fault:
- **Worker stuck**: same errors repeating, agent going in circles, not addressing feedback
- **Reviewer pedantic**: severity trending down (HIGH → MEDIUM → LOW), each review finds genuinely new but increasingly minor issues, the reviewer should be approving with observations instead of rejecting
- **Both**: the worker is making real mistakes but the reviewer is also flagging cosmetic nits that inflate the rejection count

Real example (`blatantly-empowering-muskellunge`): Review 1 caught a real bug (missing `disallowed_tools` in `run_sync`). Review 2 caught a real boundary violation. Review 3 caught a missing warning pattern. All legitimate. Review 4 rejected for an unnecessary `.clone()` on a consumed-by-value `PathBuf` and doc comments saying "Claude" instead of "agent" — style nits that should have been observations, not rejections. The diagnostic agent needs to recognize this severity trend and direct guidance to the right agent.

Three mechanisms are proposed:
1. **Generalized loop detection** — count iterations per stage, detect any repeating pattern
2. **Diagnostic agent** — a fresh outside agent reviews the situation and either provides guidance or identifies a fundamental issue
3. **Stuck output** — agents can voluntarily signal "I need help"

All three paths converge on the **diagnostic agent** — a fresh outside agent that analyzes the situation and returns one of three verdicts: the loop is productive and should continue, guidance to break a real stuck loop, or identification of a fundamental issue requiring human intervention.

---

## Part 1: Generalized Loop Detection

### New module: `loop_detection.rs`

Create `crates/orkestra-core/src/workflow/services/loop_detection.rs` — pure functions, no side effects.

```rust
/// Thresholds for loop detection.
pub struct LoopThresholds {
    /// After this many iterations in a stage, spawn diagnostic agent.
    pub diagnose_after: u32,  // default: 3
}

impl Default for LoopThresholds {
    fn default() -> Self {
        Self { diagnose_after: 3 }
    }
}

/// Result of loop analysis.
pub enum LoopVerdict {
    /// No loop — continue normally.
    Continue,
    /// Loop detected — spawn diagnostic agent.
    Diagnose {
        cycle_count: u32,
        /// Deduplicated summary of errors/feedback from recent iterations.
        error_history: Vec<String>,
    },
}

/// Analyze iterations for a stage to detect unproductive loops.
/// Pure function — counts consecutive "retry-like" iterations
/// (triggered by ScriptFailure or Rejection).
pub fn detect_loop(
    iterations: &[Iteration],
    target_stage: &str,
    thresholds: &LoopThresholds,
) -> LoopVerdict
```

**Logic**: Filter iterations for `target_stage`. Count consecutive iterations from the end that have a retry-like trigger (`ScriptFailure` or `Rejection`), but treat `DiagnosticContinue` triggers as reset points — they represent a previous diagnostic check that said "keep going." Count only iterations *since the last diagnostic check* (or from the start if there hasn't been one). If that count >= `diagnose_after`, return `Diagnose`. Otherwise `Continue`.

This means: if the diagnoser says "this is productive, keep going", the counter resets. But if the loop persists for another `diagnose_after` iterations after that, we re-diagnose. The diagnoser gets called repeatedly as long as the loop continues, each time with fresh context about the latest iterations.

### Hook points (two locations)

**1. `process_script_failure()`** — `agent_actions.rs:866`

Before creating the recovery iteration in the `if let Some(target) = recovery_stage` branch, query iterations and call `detect_loop()`. If verdict is `Diagnose`, spawn diagnostic agent instead of creating a normal iteration.

**2. `execute_rejection()`** — `agent_actions.rs:306`

Before creating the rejection iteration (line 339), query iterations for the target stage and call `detect_loop()`. If verdict is `Diagnose`, spawn diagnostic agent instead.

Both hook points follow the same pattern:
1. Query iterations: `self.store.get_iterations(&task.id)?`
2. Call `detect_loop(iterations, target_stage, &thresholds)`
3. On `Continue` → existing behavior
4. On `Diagnose` → set `Phase::Diagnosing`, save task, return (orchestrator will spawn diagnostic agent)

### Configuration

Add optional `max_recovery_cycles` to `ScriptStageConfig` in `workflow/config/stage.rs` for per-stage override. Add a top-level `loop_detection` section to `WorkflowConfig` for global defaults:

```yaml
loop_detection:
  diagnose_after: 3  # default
```

---

## Part 2: Diagnostic Agent

When a loop is detected, instead of injecting more context into the already-confused agent, spawn a **fresh diagnostic agent** that reviews the situation from the outside.

### Why a fresh agent?

The working agent's accumulated context is part of the problem — it's been seeing the same errors and making the same wrong assumptions across iterations. A fresh agent has no preconceptions and can identify patterns the stuck agent can't.

### Diagnostic agent output schema

Four possible outcomes:

```json
{
  "type": "forward_progress",
  "analysis": "Evidence that the agent is making real progress despite repeated iterations"
}
```
or
```json
{
  "type": "guidance",
  "target_stage": "work",
  "analysis": "Root cause analysis of why the agent is stuck",
  "instructions": "Detailed step-by-step guidance for resolving the issue"
}
```
or
```json
{
  "type": "adjust_reviewer",
  "target_stage": "review",
  "analysis": "The reviewer is being too strict — severity is trending down and remaining findings are cosmetic",
  "instructions": "Approve the current work. The remaining issues (unnecessary clone, doc comment wording) are style nits that do not affect correctness or architecture."
}
```
or
```json
{
  "type": "fundamental_issue",
  "analysis": "Explanation of the fundamental problem",
  "reason": "Why this cannot be resolved by the agent"
}
```

**`target_stage`** tells the system which agent to intervene on. For `guidance`, this is typically the stage that keeps failing (e.g. `"work"` if the worker is stuck, or the failing script's recovery stage). For `adjust_reviewer`, this is the reviewing stage — the diagnostic's instructions get injected into the *reviewer's* next iteration as additional context, telling it to lower its bar.

### Implementation: follow the commit message pattern

The diagnostic agent follows the same pattern as commit message generation (`orchestrator.rs` background threads):

1. **New Phase: `Phase::Diagnosing`** — signals that a diagnostic agent is running
2. **Orchestrator tick**: in `process_completed_agents()` or a new `process_diagnostics()` step, check for tasks in `Phase::Diagnosing` with completed diagnostic processes
3. **Background spawning**: gather inputs while holding lock, drop lock, spawn diagnostic agent in background thread, callback into API when done

### Diagnostic prompt template

Create `crates/orkestra-core/src/prompts/templates/diagnostic.md` — an internal template (not user-configurable, like commit messages):

```markdown
You are a diagnostic agent reviewing a task that has been looping. Your job is
to analyze WHY and determine the best path forward.

## Task
- Title: {{title}}
- Description: {{description}}
- Current stage: {{stage}}
- Loop type: {{loop_type}}
- Iteration count at this stage: {{cycle_count}}

## Pipeline Context
The task moves through stages: {{stage_pipeline}}
The loop is between: {{loop_stages}}

## Iteration History
{{#each iterations}}
### Iteration {{this.iteration_number}} [{{this.stage}}]
- Trigger: {{this.trigger_summary}}
- Outcome: {{this.outcome_summary}}
{{/each}}

## Recent Errors / Rejection Feedback
{{#each errors}}
---
{{this}}
{{/each}}

## Git Log (recent commits on this task branch)
{{git_log}}

## Your Task

**Important: rejection loops involve TWO agents.** When a reviewer rejects work,
there is a working agent AND a reviewing agent. You must determine which one (or
both) is the problem:

- **Worker stuck**: the worker keeps making the same mistakes, isn't addressing
  feedback, or is going in circles. Signs: same errors repeat, reviewer feedback
  is consistent and valid, git log shows the same files being changed back and
  forth.

- **Reviewer too strict**: the reviewer keeps finding new but increasingly minor
  issues instead of approving. Signs: finding severity trends downward across
  reviews (HIGH → MEDIUM → LOW → cosmetic), each review finds genuinely different
  things (not repeating), the worker IS addressing feedback successfully, but the
  reviewer keeps raising the bar with style nits, unnecessary clones, doc comment
  wording, etc. that should be observations rather than rejections.

- **Script failure**: for script loops, there is only one agent — the worker.
  The script is an automated check.

Determine ONE of:

1. **Forward progress** — the work IS progressing productively. Each iteration
   addresses real issues, error counts are decreasing, or the reviewer is finding
   legitimately important things each time. Let the loop continue — you'll be
   consulted again if it persists.

2. **Guidance for the worker** — the working agent is genuinely stuck. Provide
   specific, actionable instructions to break the loop. The worker will get a
   FRESH start with your instructions as its only context about prior failures.
   Set `target_stage` to the worker's stage name.

   Also decide whether to reset the worktree:
   - `"none"` — keep existing code as-is
   - `"loop_start"` — undo the commits from the failed iterations (recommended
     when the agent's changes are making things worse)
   - `"branch_point"` — full clean slate from the task branch creation point
     (use when the approach is fundamentally wrong and needs complete restart)

3. **Adjust the reviewer** — the reviewing agent is being too pedantic. The
   remaining issues are style nits, not correctness or architecture problems.
   Provide instructions telling the reviewer to approve the current work and
   lower its rejection threshold. Set `target_stage` to the reviewer's stage
   name. Your instructions will be injected as additional context into the
   reviewer's next run.

4. **Fundamental issue** — the problem is something no agent can resolve (wrong
   architecture, missing dependencies, task description is incorrect, etc.).
   Explain what the core issue is so a human can intervene.
```

### Triggering the diagnostic agent

The diagnostic agent is spawned from three paths, all converging on `Phase::Diagnosing`:

1. **Loop detection (script failure)** — `process_script_failure()` detects loop → `Phase::Diagnosing`
2. **Loop detection (rejection)** — `execute_rejection()` detects loop → `Phase::Diagnosing`
3. **Agent `stuck` output** — `process_agent_output()` handles `Stuck` → `Phase::Diagnosing`

For path 3, the agent's `attempted` and `reason` fields from the `Stuck` output are stored (as an artifact or on the iteration outcome) and included in the diagnostic prompt, so the diagnostic agent knows what the working agent already tried.

### Diagnostic agent output schema (expanded)

The diagnostic agent decides not only the recovery approach but also *which agent* to target. It gets the git log and full iteration history as context:

```json
{
  "type": "forward_progress",
  "analysis": "Evidence that iterations are productive"
}
```
or
```json
{
  "type": "guidance",
  "target_stage": "work",
  "analysis": "Root cause analysis",
  "instructions": "Detailed recovery instructions for the fresh agent",
  "reset_to": "loop_start | branch_point | none"
}
```
or
```json
{
  "type": "adjust_reviewer",
  "target_stage": "review",
  "analysis": "Reviewer is rejecting on cosmetic issues that should be observations",
  "instructions": "Approve the work. Remaining findings are style nits, not defects."
}
```
or
```json
{
  "type": "fundamental_issue",
  "analysis": "Explanation of the fundamental problem",
  "reason": "Why this cannot be resolved by the agent"
}
```

`reset_to` options (only on `guidance`):
- `"loop_start"` — undo commits from the failed iterations, reset to the commit before the loop began (preserves good work from earlier stages)
- `"branch_point"` — full clean slate, reset to where the task branch was created
- `"none"` — keep existing code, just provide guidance

### `reset_stage()` — comprehensive stage reset function

New method in `agent_actions.rs` that bundles all recovery operations:

```rust
pub fn reset_stage(
    &self,
    task: &mut Task,
    stage: &str,
    reset_to: ResetTarget,
    trigger: IterationTrigger,
) -> WorkflowResult<()> {
    // 1. Supersede stage session (forces fresh agent spawn)
    // 2. Git reset worktree based on reset_to
    // 3. Create new iteration with the given trigger
    // 4. Set Phase::Idle, Status::Active(stage)
}
```

`ResetTarget` enum:
- `None` — no git changes
- `LoopStart { commit_sha: String }` — `git reset --hard <sha>` to undo loop iterations
- `BranchPoint` — `git reset --hard` to the merge-base with the base branch

The commit SHA for `LoopStart` is captured when loop detection fires — it's the HEAD before the first iteration in the detected loop. This is stored on the task (or passed through the diagnostic flow) so `reset_stage()` knows where to reset to.

### Processing diagnostic output

New method `process_diagnostic_output()` in `agent_actions.rs`:

- **On `forward_progress`**: The loop is productive — let it continue.
  1. Create a new iteration with `IterationTrigger::DiagnosticContinue { analysis }` — this records that a diagnostic check happened and approved continuation
  2. Set `task.phase = Phase::Idle` so the normal retry proceeds
  3. The `DiagnosticContinue` trigger acts as a reset point for loop detection — the counter starts fresh from here, so the next `diagnose_after` iterations run uninterrupted before re-checking

- **On `guidance`**: Worker is stuck — reset and give fresh instructions.
  1. Call `reset_stage()` with the diagnostic's `reset_to` mapped to `ResetTarget`
  2. Use `IterationTrigger::DiagnosticGuidance { analysis, instructions }` as the trigger
  3. This supersedes the worker's session, optionally resets git, and creates a fresh iteration
  4. `target_stage` determines which stage gets the fresh iteration (usually the worker stage)

- **On `adjust_reviewer`**: Reviewer is too strict — inject guidance into the reviewing stage.
  1. Create a new iteration on the *reviewer's* stage with `IterationTrigger::DiagnosticGuidance { analysis, instructions }`
  2. Supersede the reviewer's session (forces fresh reviewer spawn)
  3. The reviewer gets a fresh start with the diagnostic's instructions as additional context — e.g. "approve the current work, remaining findings are style nits"
  4. No worktree reset (the code is fine, the reviewer is the problem)
  5. The task advances back to the reviewing stage (skipping the worker — no work needed)

- **On `fundamental_issue`**:
  1. Set `task.status = Status::Stuck { reason }`
  2. Set `task.phase = Phase::Idle`
  3. Human must `retry_stuck` to continue

### New `IterationTrigger` variants

```rust
/// Diagnostic agent reviewed the loop and said "keep going, this is productive."
/// Acts as a reset point for loop detection — counter restarts from here.
DiagnosticContinue {
    analysis: String,
}

/// Diagnostic agent identified the root cause and provided recovery instructions.
/// Used for both worker guidance and reviewer adjustment — `target_stage` on the
/// iteration determines which agent gets the fresh session with these instructions.
DiagnosticGuidance {
    analysis: String,
    instructions: String,
}
```

`DiagnosticGuidance` maps to a new `ResumeType` in `agent_execution.rs` that passes the diagnostic guidance as additional context for the fresh agent session. The same trigger type is used whether targeting the worker or the reviewer — the difference is which stage's session gets superseded and which stage the new iteration is created on.

`DiagnosticContinue` doesn't change the agent's execution — the normal retry flow proceeds. Its purpose is purely as a marker in the iteration history so `detect_loop()` knows to reset its counter.

### Spawning mechanics

The diagnostic agent is spawned using the default provider (same as commit messages). It's a one-shot process:
- Uses `ProcessSpawner` from the default provider
- Gets the diagnostic prompt + JSON schema
- Output is parsed and processed via `process_diagnostic_output()`

Store the diagnostic process PID/info on a new field or reuse the existing `StageSession` mechanism with a special "diagnostic" session marker.

---

## Part 3: Stuck Output Type

Agents can voluntarily signal they're stuck — available for ALL stages, no capability flag needed. When an agent outputs `stuck`, it also triggers the diagnostic agent (same path as loop detection), giving the system a chance to auto-recover before escalating to a human.

### `StageOutput::Stuck`

In `workflow/execution/output.rs`:

```rust
Stuck {
    attempted: String,
    reason: String,
}
```

### Schema

Add to `prompts/schemas/components/terminal.json`:

```json
"stuck": {
    "properties": {
        "attempted": {
            "type": "string",
            "description": "What you tried so far"
        },
        "reason": {
            "type": "string",
            "description": "Why you cannot make progress"
        }
    },
    "required": ["attempted", "reason"]
}
```

Add `"stuck"` to `type_enum` in `generate_stage_schema()` alongside `"failed"` and `"blocked"`.

### Parsing

Add match arm in both `parse()` and `parse_unvalidated()` before the `_` fallback.

### Handler

In `process_agent_output()`, add arm after `Blocked`. Instead of immediately going to `Status::Stuck`, this triggers the diagnostic agent — same as the loop detection path:

```rust
StageOutput::Stuck { attempted, reason } => {
    self.end_current_iteration(&task, Outcome::Stuck {
        attempted: attempted.clone(),
        reason: reason.clone(),
    });
    // Trigger diagnostic agent — same path as loop detection.
    // The agent's "attempted" and "reason" become part of the
    // diagnostic context so the diagnostic agent understands
    // what the working agent already tried.
    task.phase = Phase::Diagnosing;
    task.updated_at = now;
}
```

The diagnostic agent then either provides guidance (auto-recovery with fresh session) or confirms a fundamental issue (`Status::Stuck` for human review). This means the `stuck` output is not an immediate dead end — it's a request for outside help that may resolve automatically.

---

## Part 4: New Status and Outcome Variants

### `Status::Stuck`

In `workflow/runtime/status.rs`:

```rust
Stuck {
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}
```

Add `stuck()` constructor, include in `is_terminal()`, add `Display` arm.

### `Outcome::Stuck`

In `workflow/runtime/outcome.rs`:

```rust
Stuck {
    attempted: String,
    reason: String,
}
```

### Human action: `retry_stuck`

In `human_actions.rs`, add `retry_stuck(task_id, instructions)` — similar to `retry_failed`. Creates new iteration with `IterationTrigger::RetryStuck { instructions }`.

---

## Files to Modify

| File | Change |
|------|--------|
| `workflow/services/loop_detection.rs` | **NEW** — `detect_loop()`, `LoopVerdict`, `LoopThresholds` |
| `workflow/services/mod.rs` | Add `pub mod loop_detection;` |
| `workflow/services/agent_actions.rs` | Hook `detect_loop` in `process_script_failure()` + `execute_rejection()`, add `Stuck` handler in `process_agent_output()`, add `process_diagnostic_output()` |
| `workflow/services/orchestrator.rs` | Add `process_diagnostics()` tick step, spawn diagnostic agents |
| `workflow/services/agent_execution.rs` | Map `DiagnosticGuidance` trigger to resume prompt |
| `workflow/services/human_actions.rs` | Add `retry_stuck()` |
| `workflow/runtime/status.rs` | Add `Stuck` variant |
| `workflow/runtime/outcome.rs` | Add `Stuck` variant |
| `workflow/execution/output.rs` | Add `Stuck` variant + parsing |
| `workflow/domain/iteration.rs` | Add `DiagnosticContinue`, `DiagnosticGuidance`, `RetryStuck` trigger variants |
| `workflow/config/stage.rs` | Add `max_recovery_cycles` to `ScriptStageConfig` |
| `workflow/config/workflow.rs` | Add `loop_detection` config section |
| `prompts/templates/diagnostic.md` | **NEW** — diagnostic agent prompt template |
| `prompts/schemas/components/terminal.json` | Add `stuck` schema |
| `prompts/mod.rs` | Add `stuck` to type enum and properties, diagnostic schema generation |

## Implementation Order

1. **Status + Outcome + Output types** — `Stuck` variants, parsing, schema (foundational, no behavioral change)
2. **Loop detection module** — pure functions with unit tests
3. **Hook into `process_script_failure()` and `execute_rejection()`** — detect loops, set `Phase::Diagnosing`
4. **Diagnostic agent** — prompt template, spawning, output processing
5. **`retry_stuck` human action** — recovery path
6. **E2e tests** — full loop detection → diagnosis → recovery/stuck flow

## Verification

1. **Unit tests in `loop_detection.rs`**: Both verdicts with various iteration patterns (script failures, rejections, mixed)
2. **Unit tests in `output.rs`**: Parse `stuck` output, schema validation
3. **Unit tests in `status.rs`**: Serialization, `is_terminal()`, display
4. **E2e tests**:
   - Script failure loop: stage iterates 3+ times → diagnostic agent spawned
   - Rejection loop: review rejects 3+ times → diagnostic agent spawned
   - Diagnostic returns forward_progress → normal retry continues, counter resets
   - Diagnostic returns forward_progress → loop persists another 3 iterations → re-diagnosed
   - Diagnostic returns guidance targeting worker (reset=none) → fresh worker session with guidance
   - Diagnostic returns guidance targeting worker (reset=loop_start) → worktree reset + fresh worker session
   - Diagnostic returns guidance targeting worker (reset=branch_point) → worktree reset to branch creation point
   - Diagnostic returns adjust_reviewer → reviewer session superseded, reviewer gets fresh start with diagnostic instructions, task advances to review stage (skips worker)
   - Diagnostic returns fundamental issue → task → `Status::Stuck`
   - Agent voluntarily outputs `stuck` → diagnostic agent spawned → guidance or `Status::Stuck`
   - Human `retry_stuck` with instructions → task resumes from stuck
   - `reset_stage()` supersedes session, resets git, creates iteration
5. `cargo test -p orkestra-core` — all existing tests pass
