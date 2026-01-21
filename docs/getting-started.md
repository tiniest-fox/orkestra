# Getting Started with Orkestra

Orkestra is a task orchestration system that uses AI agents to plan and implement software development tasks with human oversight.

## Quick Start

### 1. Build the Project

```bash
# Build all components (CLI, core library, and Tauri app)
cargo build
```

### 2. Create Your First Task

Using the CLI:
```bash
./target/debug/ork task create -t "Your task title" -d "Detailed description of what needs to be done"
```

### 3. View Tasks

List all tasks:
```bash
./target/debug/ork task list
```

Filter by status:
```bash
./target/debug/ork task list --status pending
./target/debug/ork task list --status in_progress
```

View task details:
```bash
./target/debug/ork task show TASK-001
```

## The Planning-Approval-Execution Flow

Orkestra follows a human-in-the-loop workflow:

```
1. CREATE     -> You describe what needs to be done
2. PLAN       -> AI planner analyzes and creates implementation plan
3. APPROVE    -> You review and approve (or request changes to) the plan
4. EXECUTE    -> AI worker implements the approved plan
5. REVIEW     -> You verify the implementation
6. COMPLETE   -> Mark the task as done
```

This ensures AI agents work on approved plans only, giving you control over what changes are made to your codebase.

## CLI Command Reference

### Task Management

| Command | Description |
|---------|-------------|
| `ork task list` | List all tasks |
| `ork task list --status STATUS` | Filter tasks by status |
| `ork task show ID` | Show task details |
| `ork task create -t TITLE -d DESC` | Create a new task |
| `ork task status ID STATUS` | Update task status |

### Plan Workflow

| Command | Description |
|---------|-------------|
| `ork task approve ID` | Approve a task's plan |
| `ork task request-changes ID --feedback MSG` | Request plan changes |

### Completion Commands (used by agents)

| Command | Description |
|---------|-------------|
| `ork task complete ID --summary MSG` | Mark task ready for review |
| `ork task fail ID --reason MSG` | Mark task as failed |
| `ork task block ID --reason MSG` | Mark task as blocked |

## Project Structure

```
your-project/
├── .orkestra/
│   └── tasks.jsonl    # Task database (auto-created)
├── agents/
│   ├── planner.md     # Planner agent definition
│   └── worker.md      # Worker agent definition
└── ... your code ...
```

## Task Statuses

- **pending** - Task created, waiting for processing
- **planning** - Planner agent is creating implementation plan
- **awaiting_approval** - Plan ready for your review
- **in_progress** - Worker agent is implementing
- **ready_for_review** - Implementation complete, awaiting verification
- **done** - Task completed and verified
- **failed** - Task could not be completed
- **blocked** - Task needs clarification

## Tips

1. **Write clear descriptions**: The more specific your task description, the better the AI plan will be.

2. **Review plans carefully**: The approval step is your chance to guide the implementation approach before any code is written.

3. **Use feedback loops**: If a plan isn't right, use `request-changes` with specific feedback rather than approving a suboptimal plan.

4. **Check execution logs**: Task logs show what tools the agent used, helpful for understanding what was done.
