---
name: ork-cli
description: Orkestra CLI for Trak management, debugging, and inspection
---

# Orkestra CLI (`ork`) Reference

The `ork` CLI is the primary tool for Trak management and debugging outside the UI. Use it to create Traks, inspect state, view agent logs, and manage the Trak lifecycle.

## Development Usage

During development, use the wrapper script which handles building automatically:

```bash
bin/ork trak list
bin/ork trak show <task-id>
bin/ork trak create -t "Title" -d "Description"
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `ork trak list` | List all Traks with optional filters |
| `ork trak show <ID>` | Show Trak details, artifacts, metadata |
| `ork trak create -t TITLE -d DESC` | Create a new Trak |
| `ork trak approve <ID>` | Approve current stage |
| `ork trak reject <ID> -f MSG` | Reject with feedback |
| `ork trak merge <ID>` | Merge Done Trak's branch into base |
| `ork trak open-pr <ID>` | Create PR for a Done Trak |
| `ork trak retry-pr <ID>` | Retry failed PR creation |
| `ork trak retry <ID>` | Retry a failed/blocked Trak |
| `ork logs <ID> --stage NAME` | View agent/script logs |

Add `--pretty` to any command for human-readable output instead of JSON.

## Trak Management Commands

### Listing Traks

```bash
# All Traks
ork trak list

# Filter by status
ork trak list --status active    # Currently in progress
ork trak list --status done      # Completed
ork trak list --status archived  # Merged to main
ork trak list --status failed    # Failed Traks
ork trak list --status blocked   # Blocked on dependency

# Filter by relationships
ork trak list --parent <ID>      # Subtraks of a parent
ork trak list --depends-on <ID>  # Traks depending on this Trak
```

### Inspecting Traks

```bash
# Basic Trak details
ork trak show <ID>

# With iteration history (stages, outcomes, feedback)
ork trak show <ID> --iterations

# With session history (spawning, PIDs, state)
ork trak show <ID> --sessions

# With git state (branch, HEAD, dirty status)
ork trak show <ID> --git

# Full diagnostic view (combine all)
ork trak show <ID> --iterations --sessions --git
```

### Creating Traks

```bash
# Basic Trak creation
ork trak create -t "Fix login bug" -d "Users can't log in with email"

# With specific base branch
ork trak create -t "Add feature" -d "Description" -b feature-branch

# With a named flow (shorter pipeline)
ork trak create -t "Hotfix" -d "Critical fix" --flow hotfix
```

Options:
- `-t, --title`: Trak title (required)
- `-d, --description`: Trak description (required)
- `-b, --base-branch`: Base branch for worktree (optional, defaults to main)
- `--flow <NAME>`: Assign to a named flow (e.g., "quick", "hotfix")

### Approving and Rejecting

```bash
# Approve current stage, advance to next
ork trak approve <ID>

# Reject with feedback (creates new iteration)
ork trak reject <ID> --feedback "Missing error handling"
ork trak reject <ID> -f "Needs tests"
```

### Integration Commands

```bash
# Merge a Done Trak's branch into its base branch
ork trak merge <ID>

# Create a pull request for a Done Trak
ork trak open-pr <ID>

# Retry failed PR creation (recovers Failed → Done)
ork trak retry-pr <ID>
```

### Retry Commands

```bash
# Retry a failed or blocked Trak (recovers to Idle phase)
ork trak retry <ID>

# Retry with specific instructions for the agent
ork trak retry <ID> --instructions "Focus on the auth module only"
ork trak retry <ID> -i "Skip the refactoring, just fix the bug"
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
ork logs <ID> --stage check --type tool_use       # Tool calls

# Pagination
ork logs <ID> --stage work --limit 50          # First 50 entries
ork logs <ID> --stage work --limit 50 --offset 100  # Skip first 100
```

## Status Values

| Status | Meaning |
|--------|---------|
| `Active(<stage>)` | Working on the named stage |
| `Waiting(<stage>)` | Waiting for child Traks to complete |
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
| `Finished` | Trak fully complete |

## Common Workflows

### Creating and Tracking a Trak

```bash
# Create the Trak
ork trak create -t "Add user notifications" -d "Send email on important events"

# Watch progress (Traks start automatically)
ork trak list --status active --pretty

# Check specific Trak state
ork trak show <ID> --pretty
```

### Debugging a Stuck Trak

```bash
# Full diagnostic view
ork trak show <ID> --iterations --sessions --git --pretty

# Check what happened in the stage
ork logs <ID> --stage work --pretty

# Look for errors
ork logs <ID> --stage work --type error
```

### Reviewing Agent Work

```bash
# See what the agent produced
ork trak show <ID> --pretty

# Check the agent's reasoning
ork logs <ID> --stage work --type text

# See tool usage
ork logs <ID> --stage work --type tool_use
```

### Handling Rejections

```bash
# Reject with specific feedback
ork trak reject <ID> -f "Missing edge case handling for empty arrays"

# The Trak returns to Idle, creating a new iteration
# The agent will receive the feedback in their next prompt
ork trak show <ID> --iterations --pretty
```

### Retrying Failed Traks

```bash
# Retry a failed Trak with guidance
ork trak retry <ID> -i "The API changed, use v2 endpoint instead"

# Retry a failed PR creation
ork trak retry-pr <ID>
```

### Integrating Completed Work

```bash
# Merge directly (for local integration)
ork trak merge <ID>

# Or create a PR (for team review)
ork trak open-pr <ID>
```

## Reference Files

| File | Role |
|------|------|
| `docs/cli-guide.md` | Full CLI documentation |
| `cli/src/main.rs` | CLI entry point and all command implementations |
| `crates/orkestra-core/src/workflow/services/api.rs` | Core API that CLI wraps |
