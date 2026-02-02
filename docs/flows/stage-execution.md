# Flow: Stage Execution

How a task goes from "needs work" to "output processed" — the path through the orchestrator, session management, prompt building, agent spawning, and output handling.

## Files Involved

| File | Role |
|------|------|
| `workflow/services/orchestrator.rs` | Tick loop: detects idle tasks, dispatches to executor, processes results |
| `workflow/services/stage_execution.rs` | Unified spawn entry point: creates session, delegates to agent or script service |
| `workflow/services/agent_execution.rs` | Builds prompt, generates schema, spawns Claude Code process |
| `workflow/services/prompt_service.rs` | Facade over prompt building: resolves flow overrides, loads templates |
| `workflow/services/session_service.rs` | Session lifecycle: create, record PID, resume detection, trigger delivery |
| `workflow/services/iteration_service.rs` | Iteration lifecycle: create, end with outcome, per-stage numbering |
| `workflow/services/agent_actions.rs` | Output processing: artifact storage, questions, subtasks, approval, failure |
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

1. **Orchestrator detects idle task** — `orchestrator.rs::start_new_executions()` finds tasks with `Idle` phase + `Active` status + dependencies satisfied. Extracts trigger from active iteration (if not already delivered). Marks task `AgentWorking`, then calls `stage_executor.spawn()`.

2. **StageExecutionService creates session and dispatches** — `stage_execution.rs::spawn()` creates a `StageSession` via `SessionService`, gets spawn context (`session_id` + `is_resume` flag), then delegates to `spawn_agent()` or `spawn_script()`. Records PID after successful spawn.

3. **AgentExecutionService builds prompt and spawns** — `agent_execution.rs::execute_stage()` generates the JSON schema from `StageCapabilities` (via `prompts/mod.rs`), builds the prompt (full on first spawn, short resume prompt on subsequent spawns), and spawns the agent via `AgentRunner`. The runner resolves the stage's `model` spec through `ProviderRegistry` to select a provider and model. If the provider lacks `supports_json_schema` (e.g., OpenCode), the schema is embedded in the prompt text instead of passed as a CLI flag.

4. **Agent runs and produces JSON output** — The agent CLI executes with provider-appropriate flags (Claude Code uses `--json-schema`; OpenCode uses `--format json` with schema in prompt). Output is one of: `Artifact`, `Questions`, `Subtasks`, `Approval`, `Failed`, `Blocked`. During execution, stdout lines are parsed in real-time by a `StreamParser` (provider-specific: `ClaudeStreamParser` or `OpenCodeStreamParser`) into `LogEntry` values and emitted as `RunEvent::LogLine` events from `runner.rs`.

5. **Orchestrator polls completion and drains logs** — `orchestrator.rs::process_completed_executions()` non-blocking polls all active agents/scripts. `stage_execution.rs::poll()` drains buffered `LogLine` events and persists them to the database via `WorkflowStore::append_log_entry()`. Dispatches results to `api.process_agent_output()` or `api.process_script_success/failure()`.

6. **Output processing** — `agent_actions.rs::process_agent_output()` dispatches by output type: stores artifacts, records questions, stores subtask JSON, processes approval decisions, or marks task failed/blocked. Sets phase to `AwaitingReview` or auto-advances to next stage.

## Phase Transitions

```
Idle ──[orchestrator]──> AgentWorking ──[output]──> AwaitingReview
                                                     or Idle (auto-advance to next stage)
                                                     or Idle (failed/blocked)
```

## Resume vs First Spawn

| Aspect | First Spawn | Resume |
|--------|-------------|--------|
| `spawn_context.is_resume` | `false` | `true` |
| Prompt | Full (agent def + task context + artifacts) | Short (feedback/answers/continue) |
| JSON Schema | Generated from stage config | Same — regenerated each time |
| Claude Code flag | `--session-id {id}` | `--resume {id}` |
| OpenCode flag | `--session {id}` | `--continue {id}` |
| Session `spawn_count` | 0 before, 1 after | N before, N+1 after |

## Trigger Types and Their Sources

| Trigger | Created by | Resume prompt type |
|---------|-----------|-------------------|
| `None` | First iteration (no context) | `Continue` |
| `Interrupted` | Crash recovery | `Continue` |
| `Feedback { feedback }` | Human rejection (`human_actions.rs::reject`) | `Feedback` |
| `Answers { answers }` | Human answers questions (`human_actions.rs::answer_questions`) | `Answers` |
| `Integration { message, files }` | Merge conflict (`integration.rs::integration_failed`) | `Integration` |
| `ScriptFailure { from_stage, error }` | Script stage failed (`agent_actions.rs::process_script_failure`) | `Feedback` (formatted) |
| `Rejection { from_stage, feedback }` | Agent rejected via approval (`agent_actions.rs::handle_approval_output`) | `Feedback` |

## Non-Obvious Behaviors

- **One-tick delay for integration**: Tasks that become Done in tick N are only eligible for integration in tick N+1. This prevents race conditions between output processing and integration.
- **Trigger delivery flag**: After a resume spawn delivers the trigger to the agent, `trigger_delivered` is set to true. If the agent crashes again, the next resume uses "session was interrupted" instead of replaying the original trigger.
- **Subtask creation is deferred**: When an agent outputs subtasks, only the JSON is stored. Actual Task records are created when the human approves (or auto-advance triggers). This is in `human_actions.rs::approve_with_subtask_creation`.
- **Script failures route to recovery stage**: A failed script with `on_failure: "work"` creates a new iteration in the work stage with a `ScriptFailure` trigger. The agent receives this as feedback.
- **ANSI stripping**: Script output is stripped of ANSI escape codes before storage as artifacts, so downstream agents don't waste tokens on terminal formatting.
- **Auto-mode**: Tasks with `auto_mode: true` automatically answer questions and auto-advance through approval gates. The auto-answer text is a constant: "Make a decision based on your best understanding and highest recommendation."
- **Schema composition**: `generate_stage_schema()` in `prompts/mod.rs` builds a discriminated union from component JSON files in `prompts/schemas/components/`. The `type` field enum and properties are assembled conditionally based on `StageCapabilities` flags. To add a new capability, add a component file and a conditional block in `generate_stage_schema()`.
- **Adding a new output type**: Add a flag to `StageCapabilities` in `config/stage.rs`, a variant to `StageOutput` in `execution/output.rs` with a parsing branch, and a handler in `agent_actions.rs::process_agent_output()`. Optionally add validation in `config/workflow.rs` (e.g., script stages cannot have agent-only capabilities).
