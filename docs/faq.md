# Frequently Asked Questions

## Installation

### What are the prerequisites for running Orkestra?

Orkestra requires:
- Rust (stable toolchain) for building the CLI and core library
- Node.js (v18+) for the frontend
- Claude Code CLI installed and configured (for AI agents)

### How do I install Orkestra?

Clone the repository and build:
```bash
git clone <repository-url>
cd orkestra
cargo build
```

For the desktop application:
```bash
npm install
npm run tauri dev
```

### Where is Orkestra data stored?

Orkestra stores all data in the `.orkestra/` directory at your project root:
- `tasks.jsonl` - Append-only task database
- `agents/` - Agent definition files

## Usage

### How do I create a task?

Use the CLI:
```bash
./target/debug/ork task create -t "Task title" -d "Detailed description"
```

Or use the desktop application's Kanban board interface.

### What is the typical workflow for a task?

1. **Create** - Define what needs to be done
2. **Plan** - AI planner creates an implementation plan
3. **Approve** - Review and approve the plan (or request changes)
4. **Execute** - AI worker implements the approved plan
5. **Review** - Verify the implementation
6. **Complete** - Mark as done

### How do I approve a plan?

```bash
./target/debug/ork task approve TASK-XXX
```

Or click the approve button in the desktop UI when viewing a task.

### How do I request changes to a plan?

```bash
./target/debug/ork task request-changes TASK-XXX --feedback "Your feedback here"
```

### Can I run multiple tasks in parallel?

Yes, Orkestra supports parallel task execution. Independent tasks can be worked on simultaneously by different agent instances.

## Features

### What types of agents does Orkestra use?

- **Planner Agent** - Analyzes tasks and creates implementation plans without writing code
- **Worker Agent** - Implements approved plans and reports completion

### Does Orkestra modify my code directly?

Only after you approve a plan. The worker agent then implements the approved changes. You can review all changes before final completion.

### How do subtasks work?

Parent tasks can be broken down into subtasks. Each subtask is executed independently, and the parent task completes when all subtasks are done.

### Can I customize the agent prompts?

Yes, agent definitions are stored in `.orkestra/agents/` as markdown files. You can modify `planner.md` and `worker.md` to customize agent behavior.

## Troubleshooting

### A task is stuck in "planning" status

The planner agent may have encountered an error. Check the task logs:
```bash
./target/debug/ork task show TASK-XXX
```

You can also try restarting the planning process.

### The worker didn't complete the task

Check if the worker encountered an error or marked the task as failed/blocked:
```bash
./target/debug/ork task show TASK-XXX
```

Review the task logs for details on what happened.

### My tasks.jsonl file seems corrupted

Since it's an append-only format, you can:
1. Back up the current file
2. Delete problematic entries
3. Or delete the file entirely and start fresh (early development, data consistency is not prioritized)

### How do I reset all tasks?

Delete the tasks database:
```bash
rm .orkestra/tasks.jsonl
```

New tasks will start fresh from TASK-001.

## Architecture

### Why append-only JSONL for storage?

- Simple and human-readable
- Easy to debug and recover from issues
- Later entries override earlier ones for the same task ID
- No database dependencies

### What is the session tracking feature?

Each agent run creates a session (plan, work, review_0, review_1...) enabling resume after interruption. This allows work to continue if an agent is stopped mid-execution.

### How does project root detection work?

Orkestra finds the workspace root by looking for:
1. `Cargo.toml` with `[workspace]`
2. `.orkestra/` directory

This ensures all commands operate in the correct project context.
