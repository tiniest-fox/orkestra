# Orkestra CLI (`ork`) Reference

Command-line tool for managing Orkestra workflow tasks. Agents don't use this directly—they output JSON. This is for human debugging and manual task management.

## Setup

Auto-detects project root by finding `Cargo.toml` with `[workspace]` or `.orkestra/` directory. Auto-creates database and loads config on first run.

## Global Flags

**`--pretty`**
- Output human-readable formatting instead of JSON
- Available on all commands

## Commands

### Task Management

**`ork task list [OPTIONS]`**
- Lists all tasks
- `--status <FILTER>`: Filter by `active`, `done`, `archived`, `failed`, or `blocked`
- `--parent <ID>`: List subtasks of a parent task
- `--depends-on <ID>`: List tasks that depend on this task

**`ork task show <ID> [OPTIONS]`**
- Shows full task details, artifacts, and metadata
- `--iterations`: Show iteration history (stages, outcomes, feedback)
- `--sessions`: Show stage session history (spawning, PIDs, state)
- `--git`: Show git state (branch, HEAD, dirty status)

**`ork task create -t <TITLE> -d <DESCRIPTION> [OPTIONS]`**
- Creates new task
- `-t, --title`: Task title (required)
- `-d, --description`: Task description (required)
- `-b, --base-branch`: Base branch for worktree (optional)
- `--flow <NAME>`: Assign task to a named flow (e.g., "quick", "hotfix")
- Creates worktree at `.orkestra/.worktrees/<task-id>` and branch `task/<task-id>` if git available

**`ork task approve <ID>`**
- Approves current stage, advances to next or marks done
- Requires task in `AwaitingReview` phase

**`ork task reject <ID> --feedback <FEEDBACK>`**
- Rejects current stage with feedback
- `-f, --feedback`: Reason for rejection (required)
- Creates new iteration, returns to `Idle` phase

### Logs

**`ork logs <TASK_ID> --stage <STAGE> [OPTIONS]`**
- View agent and script logs for a specific stage
- `--stage <NAME>`: Stage name (required)
- `--type <TYPE>`: Filter by log entry type (`text`, `error`, `tool_use`, `tool_result`, `script_output`, etc.)
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
- `Waiting(<stage>)` - Waiting on child tasks
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
- `Integrating` - Merging to main branch

## Task Lifecycle

1. `ork task create` → `Active(first_stage)`, `Awaiting Setup`
2. Orchestrator creates worktree → `Idle`
3. Orchestrator spawns agent → `Working`
4. Agent outputs → `Review`
5. `ork task approve` → next stage or `Done`
6. `ork task reject` → new iteration, back to `Idle`
7. When `Done`, orchestrator merges → `Integrating` → `Archived`

## Exit Codes

- `0` - Success
- `1` - Error (message to stderr)
