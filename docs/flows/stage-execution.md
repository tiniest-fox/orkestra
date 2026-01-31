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
| `workflow/services/agent_actions.rs` | Output processing: artifact storage, questions, subtasks, restage, failure |
| `workflow/execution/prompt.rs` | Low-level prompt assembly: template loading, context injection, resume prompts |
| `workflow/execution/output.rs` | `StageOutput` enum: the parsed agent response types |
| `workflow/execution/runner.rs` | `AgentRunner`: spawns Claude Code process, returns event channel |

All paths relative to `crates/orkestra-core/src/`.

## The Flow

### Phase 1: Orchestrator detects task needs execution

Every 100ms, `OrchestratorLoop::tick()` runs four phases. Phase 2 is `start_new_executions()`:

```
orchestrator.rs::start_new_executions()
  -> api.get_tasks_needing_agents()     // Idle phase + Active status + deps satisfied
  -> skip if stage_executor.has_active_execution(task_id)
  -> extract trigger from active iteration (if not already delivered)
  -> api.agent_started(task_id)         // Phase: Idle -> AgentWorking
  -> stage_executor.spawn(task, trigger)
```

**Key detail:** The orchestrator marks the task as `AgentWorking` BEFORE calling spawn. If spawn fails, the task is stuck in `AgentWorking` — the executor records the failure via `SessionService::on_spawn_failed()` but the phase isn't reset automatically. The next tick's `process_completed_executions()` handles this via the `PollError` path.

**Trigger extraction:** The active iteration may have an `incoming_context` (feedback, answers, script failure, etc). If `trigger_delivered` is true, it's skipped — this prevents replaying stale context after crash recovery.

### Phase 2: StageExecutionService creates session and dispatches

```
stage_execution.rs::spawn(task, trigger)
  1. session_service.on_spawn_starting(task_id, stage)
     - Creates or updates StageSession in Spawning state
     - Creates iteration if none active for this stage
     - Links iteration to session (for log recovery)
  2. session_service.get_spawn_context(task_id, stage)
     - Returns { session_id, is_resume }
     - is_resume = spawn_count > 0 (agent was previously spawned in this session)
  3. Dispatch by stage type:
     - Agent stage -> spawn_agent()
     - Script stage -> spawn_script()
  4. On success: session_service.on_agent_spawned(task_id, stage, pid)
     - Records PID, increments spawn_count, state -> Active
  5. If is_resume && trigger.is_some():
     - session_service.mark_trigger_delivered(task_id, stage)
```

**Key detail:** Session creation happens BEFORE spawn, PID recording happens AFTER. This means if the process crashes between these two points, the session exists but has no PID — startup recovery handles this.

### Phase 3: AgentExecutionService builds prompt and spawns

```
agent_execution.rs::execute_stage(task, trigger, spawn_context)
  1. Get stage config from workflow (validate it's an agent stage)
  2. Apply flow overrides to capabilities if task has a flow
  3. Generate JSON schema via get_agent_schema(stage_config)
     - Composes schema from components based on StageCapabilities
     - Always includes: artifact + terminal (failed/blocked)
     - If ask_questions: adds questions schema
     - If produce_subtasks: adds subtasks schema
     - If supports_restage non-empty: adds restage schema
  4. Build prompt:
     - If is_resume: build_resume_prompt(trigger_to_resume_type(trigger))
       -> Short prompt: "here's feedback" / "here are answers" / "continue"
     - If first spawn: prompt_service.resolve_config(workflow, task)
       -> Full prompt: agent .md template + task context + input artifacts + output format
  5. Create RunConfig with session ID and working directory
  6. runner.run_async(config) -> (pid, event_receiver)
  7. Return ExecutionHandle { task_id, stage, pid, events }
```

**Key detail:** JSON schema is generated on EVERY invocation (first spawn and resume). Claude Code requires `--json-schema` each time to enforce structured output. But the prompt differs: first spawn gets the full prompt, resume gets a short one since Claude remembers context.

### Phase 4: Prompt assembly (first spawn only)

```
prompt.rs::resolve_stage_agent_config_for(workflow, task, stage, ...)
  1. Resolve prompt path: flow override > stage.prompt_path() > "{stage_name}.md"
  2. Load agent definition from .orkestra/agents/{path} (or ~/.orkestra/agents/)
  3. Apply capability overrides from flow
  4. Build StagePromptContext:
     - Task ID, title, description
     - Input artifacts (gathered from task.artifacts based on stage.inputs)
     - Feedback, integration error context (if any)
     - Worktree path
  5. build_complete_prompt(agent_definition, context):
     - Agent definition (system instructions)
     - "---"
     - Task information block
     - Input artifacts block
     - Feedback block (if rejecting)
     - Integration error block (if merge conflict)
     - Output format section (rendered from Handlebars template with examples)
     - Worktree context note (if worktree set)
```

### Phase 5: Orchestrator processes completed output

Back in the tick loop, Phase 1 is `process_completed_executions()`:

```
orchestrator.rs::process_completed_executions()
  -> stage_executor.poll_active()      // Non-blocking check on all active agents
  -> For each completed:
     match result {
       AgentSuccess(output)  -> api.process_agent_output(task_id, output)
       AgentFailed(error)    -> api.process_agent_output(task_id, Failed { error })
       ScriptSuccess(output) -> api.process_script_success(task_id, output)
       ScriptFailed(output)  -> api.process_script_failure(task_id, error, recovery_stage)
       PollError(error)      -> emit Error event
     }
```

### Phase 6: Output processing (agent_actions.rs)

```
agent_actions.rs::process_agent_output(task_id, output)
  Validates phase == AgentWorking, then dispatches:

  Artifact { content }:
    -> Store artifact on task (keyed by stage's artifact name)
    -> auto_advance_or_review():
       If automated stage or auto_mode task:
         End iteration with Approved, advance to next stage, create new iteration
       Else:
         Phase -> AwaitingReview

  Questions { questions }:
    -> End iteration with AwaitingAnswers outcome
    -> If auto_mode: generate auto-answers, create new iteration with Answers trigger, Phase -> Idle
    -> Else: Phase -> AwaitingReview

  Subtasks { subtasks }:
    -> Create markdown artifact from subtasks
    -> Store structured JSON as "{artifact_name}_structured" (for later Task creation)
    -> auto_advance_or_review() (subtask Tasks created on approval, not here)

  Restage { target, feedback }:
    -> Validate target is in stage's supports_restage list
    -> End iteration with Restage outcome
    -> Set status to active(target), Phase -> Idle
    -> Create new iteration in target stage with Restage trigger

  Failed { error }:
    -> End iteration with AgentError outcome
    -> Status -> Failed, Phase -> Idle

  Blocked { reason }:
    -> End iteration with Blocked outcome
    -> Status -> Blocked, Phase -> Idle
```

## Phase Transitions Summary

```
Idle ──[orchestrator detects]──> AgentWorking ──[output processed]──> AwaitingReview
                                                                       or Idle (auto-advance)
                                                                       or Idle (failed/blocked)
```

## Resume vs First Spawn

| Aspect | First Spawn | Resume |
|--------|-------------|--------|
| `spawn_context.is_resume` | `false` | `true` |
| Prompt | Full (agent def + task context + artifacts) | Short (feedback/answers/continue) |
| JSON Schema | Generated from stage config | Same — regenerated each time |
| Claude Code flag | `--session-id {id}` | `--resume {id}` |
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
| `Restage { from_stage, feedback }` | Agent requested restage (`agent_actions.rs::handle_restage_output`) | `Feedback` |

## Non-Obvious Behaviors

- **One-tick delay for integration**: Tasks that become Done in tick N are only eligible for integration in tick N+1. This prevents race conditions between output processing and integration.
- **Trigger delivery flag**: After a resume spawn delivers the trigger to the agent, `trigger_delivered` is set to true. If the agent crashes again, the next resume uses "session was interrupted" instead of replaying the original trigger.
- **Subtask creation is deferred**: When an agent outputs subtasks, only the JSON is stored. Actual Task records are created when the human approves (or auto-advance triggers). This is in `human_actions.rs::approve_with_subtask_creation`.
- **Script failures route to recovery stage**: A failed script with `on_failure: "work"` creates a new iteration in the work stage with a `ScriptFailure` trigger. The agent receives this as feedback.
- **ANSI stripping**: Script output is stripped of ANSI escape codes before storage as artifacts, so downstream agents don't waste tokens on terminal formatting.
- **Auto-mode**: Tasks with `auto_mode: true` automatically answer questions and auto-advance through approval gates. The auto-answer text is a constant: "Make a decision based on your best understanding and highest recommendation."
