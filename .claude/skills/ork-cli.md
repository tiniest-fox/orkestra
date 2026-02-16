---
name: ork-cli
description: Orkestra CLI for task management, debugging, and inspection
---

# Orkestra CLI (`ork`) Reference

The `ork` CLI is the primary tool for task management and debugging outside the UI. Use it to create tasks, inspect state, view agent logs, and manage the task lifecycle.

## Development Usage

During development, use the wrapper script which handles building automatically:

```bash
bin/ork task list
bin/ork task show <task-id>
bin/ork task create -t "Title" -d "Description"
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `ork task list` | List all tasks with optional filters |
| `ork task show <ID>` | Show task details, artifacts, metadata |
| `ork task create -t TITLE -d DESC` | Create a new task |
| `ork task approve <ID>` | Approve current stage |
| `ork task reject <ID> -f MSG` | Reject with feedback |
| `ork task merge <ID>` | Merge Done task's branch into base |
| `ork task open-pr <ID>` | Create PR for a Done task |
| `ork task retry-pr <ID>` | Retry failed PR creation |
| `ork task retry <ID>` | Retry a failed/blocked task |
| `ork logs <ID> --stage NAME` | View agent/script logs |

Add `--pretty` to any command for human-readable output instead of JSON.

## Task Management Commands

### Listing Tasks

```bash
# All tasks
ork task list

# Filter by status
ork task list --status active    # Currently in progress
ork task list --status done      # Completed
ork task list --status archived  # Merged to main
ork task list --status failed    # Failed tasks
ork task list --status blocked   # Blocked on dependency

# Filter by relationships
ork task list --parent <ID>      # Subtasks of a parent
ork task list --depends-on <ID>  # Tasks depending on this task
```

### Inspecting Tasks

```bash
# Basic task details
ork task show <ID>

# With iteration history (stages, outcomes, feedback)
ork task show <ID> --iterations

# With session history (spawning, PIDs, state)
ork task show <ID> --sessions

# With git state (branch, HEAD, dirty status)
ork task show <ID> --git

# Full diagnostic view (combine all)
ork task show <ID> --iterations --sessions --git
```

### Creating Tasks

```bash
# Basic task creation
ork task create -t "Fix login bug" -d "Users can't log in with email"

# With specific base branch
ork task create -t "Add feature" -d "Description" -b feature-branch

# With a named flow (shorter pipeline)
ork task create -t "Hotfix" -d "Critical fix" --flow hotfix
```

Options:
- `-t, --title`: Task title (required)
- `-d, --description`: Task description (required)
- `-b, --base-branch`: Base branch for worktree (optional, defaults to main)
- `--flow <NAME>`: Assign to a named flow (e.g., "quick", "hotfix")

### Approving and Rejecting

```bash
# Approve current stage, advance to next
ork task approve <ID>

# Reject with feedback (creates new iteration)
ork task reject <ID> --feedback "Missing error handling"
ork task reject <ID> -f "Needs tests"
```

### Integration Commands

```bash
# Merge a Done task's branch into its base branch
ork task merge <ID>

# Create a pull request for a Done task
ork task open-pr <ID>

# Retry failed PR creation (recovers Failed → Done)
ork task retry-pr <ID>
```

### Retry Commands

```bash
# Retry a failed or blocked task (recovers to Idle phase)
ork task retry <ID>

# Retry with specific instructions for the agent
ork task retry <ID> --instructions "Focus on the auth module only"
ork task retry <ID> -i "Skip the refactoring, just fix the bug"
```

## Viewing Logs

Agent and script output is captured in structured logs:

```bash
# View logs for a specific stage
ork logs <TASK_ID> --stage planning
ork logs <TASK_ID> --stage work
ork logs <TASK_ID> --stage review

# Filter by log type
ork logs <ID> --stage work --type text         # Agent text output
ork logs <ID> --stage work --type error        # Errors
ork logs <ID> --stage work --type tool_use     # Tool calls
ork logs <ID> --stage work --type tool_result  # Tool results
ork logs <ID> --stage check --type script_output  # Script stdout/stderr

# Pagination
ork logs <ID> --stage work --limit 50          # First 50 entries
ork logs <ID> --stage work --limit 50 --offset 100  # Skip first 100
```

## Status Values

| Status | Meaning |
|--------|---------|
| `Active(<stage>)` | Working on the named stage |
| `Waiting(<stage>)` | Waiting for child tasks to complete |
| `Done` | Completed successfully |
| `Archived` | Completed and merged to main |
| `Failed: <msg>` | Cannot continue (requires manual intervention) |
| `Blocked: <msg>` | Blocked on external dependency |

## Phase Values

| Phase | Meaning |
|-------|---------|
| `Awaiting Setup` | Waiting for orchestrator to create worktree |
| `Setting Up` | Creating worktree and branch |
| `Idle` | Ready for agent to start |
| `Working` | Agent currently executing |
| `Review` | Awaiting human approve/reject |
| `Interrupted` | Agent was manually stopped |
| `Integrating` | Merging to main branch |
| `Finishing` | Completing final steps |
| `Committing` | Creating commit |
| `Finished` | Task fully complete |

## Common Workflows

### Creating and Tracking a Task

```bash
# Create the task
ork task create -t "Add user notifications" -d "Send email on important events"

# Watch progress (tasks start automatically)
ork task list --status active --pretty

# Check specific task state
ork task show <ID> --pretty
```

### Debugging a Stuck Task

```bash
# Full diagnostic view
ork task show <ID> --iterations --sessions --git --pretty

# Check what happened in the stage
ork logs <ID> --stage work --pretty

# Look for errors
ork logs <ID> --stage work --type error
```

### Reviewing Agent Work

```bash
# See what the agent produced
ork task show <ID> --pretty

# Check the agent's reasoning
ork logs <ID> --stage work --type text

# See tool usage
ork logs <ID> --stage work --type tool_use
```

### Handling Rejections

```bash
# Reject with specific feedback
ork task reject <ID> -f "Missing edge case handling for empty arrays"

# The task returns to Idle, creating a new iteration
# The agent will receive the feedback in their next prompt
ork task show <ID> --iterations --pretty
```

### Retrying Failed Tasks

```bash
# Retry a failed task with guidance
ork task retry <ID> -i "The API changed, use v2 endpoint instead"

# Retry a failed PR creation
ork task retry-pr <ID>
```

### Integrating Completed Work

```bash
# Merge directly (for local integration)
ork task merge <ID>

# Or create a PR (for team review)
ork task open-pr <ID>
```

## Reference Files

| File | Role |
|------|------|
| `docs/cli-guide.md` | Full CLI documentation |
| `cli/src/main.rs` | CLI entry point and all command implementations |
| `crates/orkestra-core/src/workflow/services/api.rs` | Core API that CLI wraps |
