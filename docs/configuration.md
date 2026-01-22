# Configuration Reference

This document describes all configuration options available in Orkestra.

## Directory Structure

Orkestra uses a `.orkestra/` directory at your project root for all configuration and runtime data:

```
your-project/
├── .orkestra/
│   ├── tasks.jsonl          # Task database (auto-created)
│   └── agents/              # Custom agent definitions
│       ├── planner.md       # Planner agent prompt
│       ├── worker.md        # Worker agent prompt
│       └── breakdown.md     # Breakdown agent prompt
└── ... your code ...
```

## Environment Variables

### PATH Configuration

Orkestra automatically adds the CLI binary location to the `PATH` environment variable when spawning agents. This allows agents to call `ork` commands without specifying the full path.

The PATH is modified in the following order:
1. Parent directory of the CLI binary
2. Existing system PATH

### Claude Code Integration

Orkestra spawns Claude Code instances as agents. Ensure `claude` is available in your system PATH.

## Agent Definition Files

Agent definitions are markdown files that define the system prompt for each agent type. Orkestra searches for agent definitions in the following order:

1. **Project-local**: `.orkestra/agents/<agent-type>.md`
2. **User-global**: `~/.orkestra/agents/<agent-type>.md`
3. **Built-in defaults**: Embedded in the binary

### Available Agent Types

| Agent Type | Filename | Purpose |
|------------|----------|---------|
| `planner` | `planner.md` | Analyzes tasks and creates implementation plans |
| `worker` | `worker.md` | Implements approved plans |
| `breakdown` | `breakdown.md` | Breaks parent tasks into subtasks |

### Custom Agent Definitions

To customize agent behavior, create a markdown file in `.orkestra/agents/`:

```bash
mkdir -p .orkestra/agents
# Copy and modify the default planner
echo "# Custom Planner\n\nYour custom instructions here..." > .orkestra/agents/planner.md
```

The markdown file becomes the system prompt for that agent type. Include:
- Role description
- Instructions and constraints
- Output format expectations
- Any project-specific guidelines

## Task Storage

### tasks.jsonl Format

Tasks are stored in an append-only JSONL (JSON Lines) format at `.orkestra/tasks.jsonl`. Each line is a complete JSON object representing a task state.

```json
{"id":"TASK-001","title":"Example task","description":"...","status":"pending","created_at":"2024-01-15T10:00:00Z"}
```

Later entries for the same task ID override earlier entries, allowing for immutable history while supporting updates.

### Task Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique task identifier (e.g., `TASK-001`) |
| `title` | string | Brief task title |
| `description` | string | Detailed task description |
| `status` | string | Current task status |
| `plan` | string | Implementation plan (after planning) |
| `summary` | string | Completion summary (after completion) |
| `parent_id` | string | Parent task ID for subtasks |
| `created_at` | string | ISO 8601 timestamp |

## Project Root Detection

Orkestra automatically detects the project root by searching upward for:

1. `Cargo.toml` containing `[workspace]`
2. Existing `.orkestra/` directory

If neither is found, the current working directory is used.

## Session Tracking

Each agent run creates a session for tracking and enabling resume functionality:

| Session Type | Pattern | Description |
|--------------|---------|-------------|
| Planning | `plan` | Initial planning session |
| Working | `work` | Implementation session |
| Review | `review_0`, `review_1`, ... | Iterative review sessions |

Sessions enable resuming interrupted agent work without losing context.

## Tauri Desktop App Settings

The Tauri desktop application reads configuration from the same `.orkestra/` directory. No additional configuration files are required for the GUI.

### IPC Commands

The desktop app communicates with the core library via Tauri IPC commands. These are internal and not user-configurable.

## Default Values

| Setting | Default | Description |
|---------|---------|-------------|
| Task ID prefix | `TASK-` | Prefix for auto-generated task IDs |
| Tasks file | `.orkestra/tasks.jsonl` | Task storage location |
| Agent timeout | None | No default timeout for agent operations |

## Troubleshooting Configuration

### Agent Not Found

If you see "Agent definition not found" errors:

1. Check that the agent file exists in `.orkestra/agents/` or `~/.orkestra/agents/`
2. Verify the filename matches the agent type (e.g., `planner.md` for planner)
3. Ensure the file is readable

### Project Root Not Detected

If Orkestra can't find your project root:

1. Create a `.orkestra/` directory manually: `mkdir .orkestra`
2. Or ensure your `Cargo.toml` contains `[workspace]`

### Tasks Not Persisting

If tasks aren't being saved:

1. Check write permissions on `.orkestra/tasks.jsonl`
2. Verify the `.orkestra/` directory exists
3. Check for disk space issues
