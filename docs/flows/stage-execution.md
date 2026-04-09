# Flow: Stage Execution

How a Trak goes from "needs work" to "output processed" — the path through the orchestrator, session management, prompt building, agent spawning, and output handling.

## Files Involved

| File | Role |
|------|------|
| `workflow/services/orchestrator.rs` | Tick loop: detects idle Traks, dispatches to executor, processes results |
| `workflow/services/stage_execution.rs` | Unified spawn entry point: creates session, delegates to agent or script service |
| `workflow/services/agent_execution.rs` | Builds prompt, generates schema, spawns Claude Code process |
| `workflow/services/prompt_service.rs` | Facade over prompt building: resolves flow overrides, loads templates |
| `workflow/services/session_service.rs` | Session lifecycle: create, record PID, resume detection, trigger delivery |
| `workflow/services/iteration_service.rs` | Iteration lifecycle: create, end with outcome, per-stage numbering |
| `workflow/services/agent_actions.rs` | Output processing: artifact storage, questions, Subtraks, approval, failure |
| `workflow/execution/prompt.rs` | Low-level prompt assembly: template loading, context injection, resume prompts |
| `workflow/execution/output.rs` | `StageOutput` enum: the parsed agent response types |
| `workflow/execution/runner.rs` | `AgentRunner`: resolves provider via registry, spawns agent process, returns event channel |
| `workflow/execution/provider_registry.rs` | `ProviderRegistry`: maps model specs to `ProcessSpawner` implementations with capabilities |
| `workflow/services/stream_parser.rs` | `StreamParser` trait + provider-specific parsers: converts stdout lines into `LogEntry` values |
| `workflow/services/log_service.rs` | Thin DB wrapper for log entry queries |
| `workflow/config/stage.rs` | `StageCapabilities`: flags that control schema composition and output types |
| `prompts/mod.rs` | `generate_stage_schema()`: composes JSON schema from component files based on capabilities |
| `prompts/schemas/components/*.json` | Reusable schema fragments (artifact, questions, subtasks, approval, terminal) |

All paths relative to `crates/orkestra-core/src/`.

## Step Summary

1. **Orchestrator detects idle Trak** — `orchestrator.rs::start_new_executions()` finds Traks with `Idle` phase + `Active` status + dependencies satisfied. Extracts trigger from active iteration (if not already delivered). Marks Trak `AgentWorking`, then calls `stage_executor.spawn()`.

2. **StageExecutionService creates session and dispatches** — `stage_execution.rs::spawn()` creates a `StageSession` via `SessionService`, gets spawn context (`session_id` + `is_resume` flag), then delegates to `spawn_agent()` or `spawn_script()`. Records PID after successful spawn.

3. **AgentExecutionService builds prompt and spawns** — `agent_execution.rs::execute_stage()` generates the JSON schema from `StageCapabilities` (via `prompts/mod.rs`), builds a system prompt (agent definition + output format) and user message (Trak context — full on first spawn, short resume prompt on subsequent spawns), and spawns the agent via `AgentRunner`. The runner resolves the stage's `model` spec through `ProviderRegistry` to select a provider and model. If the provider lacks `supports_json_schema` (e.g., OpenCode), the schema is embedded in the prompt text. If the provider lacks `supports_system_prompt` (e.g., OpenCode), the system prompt and user message are concatenated into a single prompt.

4. **Agent runs and produces JSON output** — The agent CLI executes with provider-appropriate flags (Claude Code uses `--json-schema`; OpenCode uses `--format json` with schema in prompt). Output is one of: `Artifact`, `Questions`, `Subtasks`, `Approval`, `Failed`, `Blocked`. During execution, stdout lines are parsed in real-time by a `StreamParser` (provider-specific: `ClaudeStreamParser` or `OpenCodeStreamParser`) into `LogEntry` values and emitted as `RunEvent::LogLine` events from `runner.rs`.

5. **Orchestrator polls completion and drains logs** — `orchestrator.rs::process_completed_executions()` non-blocking polls all active agents/scripts. `stage_execution.rs::poll()` drains buffered `LogLine` events and persists them to the database via `WorkflowStore::append_log_entry()`. Dispatches results to `api.process_agent_output()` or `api.process_gate_success/failure()`.

6. **Output processing** — `agent_actions.rs::process_agent_output()` dispatches by output type: stores artifacts, records questions, stores Subtrak JSON, processes approval decisions, or marks Trak failed/blocked. Sets phase to `AwaitingReview` or auto-advances to next stage.

## Phase Transitions

```
Idle ──[orchestrator]──> AgentWorking ──[output]──────> AwaitingReview
                              │                         or Idle (auto-advance to next stage)
                              │                         or Idle (failed/blocked)
                              │
                              └──[interrupt]──> Interrupted ──[resume]──> Idle
```

## Resume vs First Spawn

| Aspect | First Spawn | Resume |
|--------|-------------|--------|
| `spawn_context.is_resume` | `false` | `true` |
| System prompt | Agent definition + output format | Same (re-sent) |
| User message | Full (Trak context + artifacts) | Short (feedback/answers/continue/recheck) |
| Artifact injection | Always included in user message | Only in `Recheck` resume type |
| JSON Schema | Generated from stage config | Same — regenerated each time |
| Claude Code flag | `--session-id {id}` + `--append-system-prompt` | `--resume {id}` + `--append-system-prompt` |
| OpenCode flag | `--session {id}` (system+user concatenated) | `--continue {id}` (system+user concatenated) |
| Session `spawn_count` | 0 before, 1 after | N before, N+1 after |

**Compaction resilience:** The prompt is split into two parts. The system prompt (agent definition + output format) is sent via `--append-system-prompt` on both first spawn and resume. This content survives Claude Code's auto-compaction, ensuring agents retain their core identity and output rules throughout long sessions. The user message (task context) is sent via stdin and can be safely compacted — summaries preserve the Trak "gist" well enough. For providers that don't support `--append-system-prompt` (e.g., OpenCode), the two parts are concatenated into a single prompt.

## Trigger Types and Their Sources

| Trigger | Created by | Resume prompt type |
|---------|-----------|-------------------|
| `None` | First iteration (no context) | `Continue` |
| `Interrupted` | Crash recovery | `Continue` |
| `ManualResume { message }` | Human resumes interrupted Trak (`human_actions.rs::resume`) | `ManualResume` |
| `Feedback { feedback }` | Human rejection (`human_actions.rs::reject`) | `Feedback` |
| `Answers { answers }` | Human answers questions (`human_actions.rs::answer_questions`) | `Answers` |
| `Integration { message, files }` | Merge conflict (`integration.rs::integration_failed`) | `Integration` |
| `GateFailure { from_stage, error }` | Gate script failed (`agent_actions.rs::process_gate_failure`) | `Feedback` (formatted) |
| `Rejection { from_stage, feedback }` | Agent rejected via approval (`agent_actions.rs::handle_approval_output`) | `Feedback` |
| Stage re-entry after upstream re-run | Set by `is_stage_reentry` flag in `build_stage_prompt()` | `Recheck` |

## Non-Obvious Behaviors

- **One-tick delay for integration**: Traks that become Done in tick N are only eligible for integration in tick N+1. This prevents race conditions between output processing and integration.
- **Trigger delivery flag**: After a resume spawn delivers the trigger to the agent, `trigger_delivered` is set to true. If the agent crashes again, the next resume uses "session was interrupted" instead of replaying the original trigger.
- **Subtrak creation is deferred**: When an agent outputs Subtraks, only the JSON is stored. Actual Task records are created when the human approves (or auto-advance triggers). This is in `human_actions.rs::approve_with_subtask_creation`.
- **Gate failures route to recovery stage**: A failed gate script with `on_failure: "work"` creates a new iteration in the work stage with a `GateFailure` trigger. The agent receives this as feedback.
- **ANSI stripping**: Script output is stripped of ANSI escape codes before storage as artifacts, so downstream agents don't waste tokens on terminal formatting.
- **Auto-mode**: Traks with `auto_mode: true` automatically answer questions and auto-advance through approval gates. The auto-answer text is a constant: "Make a decision based on your best understanding and highest recommendation."
- **Artifact injection in resume prompts**: When resuming with `Recheck` (cross-session re-entry after upstream stages re-run), `build_resume_prompt()` injects the stage's input artifacts into the prompt. This ensures agents see updated artifacts when upstream stages produce new outputs between sessions. Other resume types (`Continue`, `Feedback`, `Answers`, `Integration`) don't need artifacts because they operate within a single session where artifacts are already in memory. `RetryFailed` and `RetryBlocked` could theoretically benefit if upstream stages change between retries — monitor for this pattern.
- **Activity logs**: Agents can output an optional `activity_log` field (short summary string) alongside their main output (artifact/approval/Subtraks). The log is persisted on the iteration and injected into prompts for downstream stages via `StagePromptContext.activity_logs`. This provides summarized context of prior work without requiring agents to re-read full artifacts. Activity logs from completed iterations are included in the initial prompt template.
- **Schema composition**: `generate_stage_schema()` in `prompts/mod.rs` builds a discriminated union from component JSON files in `prompts/schemas/components/`. The `type` field enum and properties are assembled conditionally based on `StageCapabilities` flags. To add a new capability, add a component file and a conditional block in `generate_stage_schema()`.
- **Adding a new output type**: Add a flag to `StageCapabilities` in `config/stage.rs`, a variant to `StageOutput` in `execution/output.rs` with a parsing branch, and a handler in `agent_actions.rs::process_agent_output()`.
