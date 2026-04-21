# Orkestra CLI (`ork`) Reference

Command-line tool for managing Orkestra workflow Traks. Agents don't use this directly—they output JSON. This is for human debugging and manual Trak management.

## Setup

Auto-detects project root by finding `Cargo.toml` with `[workspace]` or `.orkestra/` directory. Auto-creates database and loads config on first run.

## Global Flags

**`--pretty`**
- Output human-readable formatting instead of JSON
- Available on all commands

## Commands

### Trak Management

**`ork trak list [OPTIONS]`**
- Lists all Traks
- `--status <FILTER>`: Filter by `active`, `done`, `archived`, `failed`, or `blocked`
- `--parent <ID>`: List subtraks of a parent Trak
- `--depends-on <ID>`: List Traks that depend on this Trak

**`ork trak show <ID> [OPTIONS]`**
- Shows full Trak details, artifacts, and metadata
- `--iterations`: Show iteration history (stages, outcomes, feedback)
- `--sessions`: Show stage session history (spawning, PIDs, state)
- `--git`: Show git state (branch, HEAD, dirty status)

**`ork trak create -t <TITLE> -d <DESCRIPTION> [OPTIONS]`**
- Creates new Trak and queues it for the desktop app or daemon to run
- `-t, --title`: Trak title (required)
- `-d, --description`: Trak description (required)
- `-b, --base-branch`: Base branch for worktree (optional)
- `--flow <NAME>`: Assign Trak to a named flow (run `ork flows` to list available flows)
- `--auto`: Set auto mode — Trak runs through stages without pausing for approval. Use `ork play` to also run it in the foreground.
- Creates worktree at `.orkestra/.worktrees/<task-id>` and branch `task/<task-id>` if git available

**`ork trak approve <ID>`**
- Approves current stage, advances to next or marks done
- Requires Trak in `AwaitingReview` phase

**`ork trak reject <ID> --feedback <FEEDBACK>`**
- Rejects current stage with feedback
- `-f, --feedback`: Reason for rejection (required)
- Creates new iteration, returns to `Idle` phase

**`ork trak skip <ID> --message <MESSAGE>`**
- Skips the current stage, advancing to the next stage (or marks Done if last stage)
- `-m, --message`: Reason for skipping (required)
- Requires Trak in `AwaitingApproval`, `AwaitingQuestionAnswer`, `AwaitingRejectionConfirmation`, or `Interrupted` phase
- The message is injected as redirect context into the next agent's prompt

**`ork trak send-to-stage <ID> --stage <STAGE> --message <MESSAGE>`**
- Sends a Trak to any named stage in the pipeline (forward or backward)
- `-s, --stage`: Target stage name (required)
- `-m, --message`: Reason for the redirect (required)
- Requires Trak in `AwaitingApproval`, `AwaitingQuestionAnswer`, `AwaitingRejectionConfirmation`, or `Interrupted` phase
- Sending backward supersedes the existing session; the agent receives the message as redirect context

**`ork trak interrupt <ID>`**
- Interrupts a running agent execution
- Kills the agent process and transitions to `Interrupted` phase
- Requires Trak in `AgentWorking` phase

**`ork trak resume <ID> [--message <MESSAGE>]`**
- Resumes an interrupted Trak
- `-m, --message`: Optional message to guide the agent on resume
- Creates new iteration with `ManualResume` trigger, returns to `Idle` phase
- Requires Trak in `Interrupted` phase

### Flows

**`ork flows`**
- Lists all available workflow flows defined in `.orkestra/workflow.yaml`
- Default output: JSON array of flow names (scriptable)
- `--pretty`: Table showing name, stages (arrow-joined), on_failure stage, and auto_merge

Example output (default):
```json
["default","quick","hotfix"]
```

Example output (`--pretty`):
```
Name                 Stages                                             On Failure      Auto Merge
-----------------------------------------------------------------------------------------------
default              planning → work → review                          work            no
quick                work                                              work            no
hotfix               work → review                                     work            yes
```

### Which command to use

| | Creates Trak | Sets Auto Mode | Runs in Foreground |
|---|---|---|---|
| `ork trak create` | Yes | No | No |
| `ork trak create --auto` | Yes | Yes | No |
| `ork play` | Yes | Yes | Yes |

- **`ork trak create`**: Queues a Trak for the desktop app or daemon to pick up and run.
- **`ork trak create --auto`**: Same, but the Trak advances through stages without pausing for human approval.
- **`ork play`**: Creates and runs a Trak to completion in the foreground — no daemon needed.

### Logs

**`ork logs <TASK_ID> --stage <STAGE> [OPTIONS]`**
- View agent and script logs for a specific stage
- `--stage <NAME>`: Stage name (required)
- `--type <TYPE>`: Filter by log entry type (`text`, `error`, `tool_use`, `tool_result`, etc.)
- `--limit <N>`: Maximum number of log entries to return (default: 100)
- `--offset <N>`: Number of log entries to skip (default: 0)

### Utilities

**`ork utility list`**
- Lists available utility tasks (currently: `generate_title`)

**`ork utility run <NAME> -c <CONTEXT_JSON>`**
- Runs utility task with JSON context
- `-c, --context`: JSON context (required)
- Example: `ork utility run generate_title -c '{"description": "Fix login bug"}'`

## Status Values

- `Active(<stage>)` - Working on stage
- `Waiting(<stage>)` - Waiting on child Traks
- `Done` - Completed successfully
- `Archived` - Completed and merged
- `Failed: <msg>` - Cannot continue
- `Blocked: <msg>` - Blocked on dependency

## Phase Values

- `Awaiting Setup` - Waiting for orchestrator to create worktree
- `Setting Up` - Creating worktree/branch
- `Idle` - Ready for work
- `Working` - Agent executing
- `Review` - Ready for approve/reject
- `Interrupted` - Agent was manually interrupted, awaiting resume
- `Integrating` - Merging to main branch

## Trak Lifecycle

1. `ork trak create` → `Active(first_stage)`, `Awaiting Setup`
2. Orchestrator creates worktree → `Idle`
3. Orchestrator spawns agent → `Working`
4. Agent outputs → `Review`
5. `ork trak approve` → next stage or `Done`
6. `ork trak reject` → new iteration, back to `Idle`
7. When `Done`, orchestrator merges → `Integrating` → `Archived`

## Exit Codes

- `0` - Success
- `1` - Error (message to stderr)
