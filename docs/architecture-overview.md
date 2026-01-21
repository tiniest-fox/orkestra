# Orkestra Architecture Overview

This document provides an overview of the Orkestra task orchestration system based on a codebase exploration.

## Project Structure

Orkestra is a Rust-based task orchestration system with a Tauri desktop UI. The project is organized as a Cargo workspace with three main components:

```
orkestra/
├── cli/                    # CLI binary for task management
├── crates/orkestra-core/   # Core library with task/agent logic
├── src-tauri/              # Tauri desktop application
├── src/                    # Frontend (likely React/TypeScript)
├── agents/                 # Agent definition files (markdown)
└── .orkestra/              # Runtime data (tasks.jsonl)
```

## Core Components

### 1. Task Management (`crates/orkestra-core/src/tasks.rs`)

Tasks are the fundamental unit of work in Orkestra. Each task has:

- **id**: Auto-generated ID in format `TASK-XXX`
- **title**: Short description of the task
- **description**: Detailed task requirements
- **status**: One of `Pending`, `InProgress`, `ReadyForReview`, `Done`, `Failed`, `Blocked`
- **timestamps**: `created_at`, `updated_at`, `completed_at`
- **metadata**: Optional `summary`, `error`, `logs`, `agent_pid`

Tasks are persisted in `.orkestra/tasks.jsonl` using an append-only JSONL format where later entries override earlier ones.

### 2. Agent System (`crates/orkestra-core/src/agents.rs`)

The agent system spawns Claude Code instances to work on tasks autonomously:

- **Agent Definitions**: Stored as markdown files in `agents/` directory (e.g., `worker.md`)
- **Prompt Building**: Combines agent definition with task details into a structured prompt
- **Process Management**: Spawns `claude` CLI with streaming JSON output
- **Log Capture**: Parses streaming events and stores formatted logs in the task

Key agent capabilities:
- Reads task requirements from the orchestrator
- Has access to the `ork` CLI for reporting completion/failure
- Streams tool usage (Bash, Read, Write, Edit, Glob, Grep) to task logs

### 3. CLI (`cli/src/main.rs`)

The `ork` CLI provides task management commands:

```bash
ork task list [--status STATUS]    # List tasks, optionally filtered
ork task show ID                   # Show task details
ork task create -t TITLE -d DESC   # Create a new task
ork task complete ID --summary MSG # Mark task ready for review
ork task fail ID --reason MSG      # Mark task as failed
ork task block ID --reason MSG     # Mark task as blocked
ork task status ID STATUS          # Update task status directly
```

### 4. Project Discovery (`crates/orkestra-core/src/project.rs`)

The system automatically finds the project root by looking for:
1. A workspace `Cargo.toml` (contains `[workspace]`)
2. An `agents/` directory

This ensures consistent paths regardless of working directory.

## Data Flow

1. User creates a task via CLI or UI
2. Orchestrator picks up pending task and spawns an agent
3. Agent receives task details via stdin prompt
4. Agent works autonomously, streaming tool usage to logs
5. Agent reports completion via `ork task complete/fail/block`
6. Task status updates in `.orkestra/tasks.jsonl`
7. UI/CLI can monitor progress and logs

## Key Design Decisions

- **Append-only JSONL**: Simple persistence without database, allows easy recovery
- **Agent definitions as markdown**: Easy to customize agent behavior
- **Streaming JSON output**: Real-time visibility into agent tool usage
- **Project root detection**: Works from any subdirectory
- **Status-based workflow**: Clear task lifecycle (Pending -> InProgress -> ReadyForReview -> Done)
