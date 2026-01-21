# Orkestra Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri Desktop App                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 React/TypeScript UI                  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │    │
│  │  │  Kanban  │ │  Agent   │ │   Task Creation   │   │    │
│  │  │  Board   │ │  Status  │ │       Form        │   │    │
│  │  └──────────┘ └──────────┘ └───────────────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   Rust Backend                       │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │    │
│  │  │  Task    │ │  Agent   │ │   File Watcher   │    │    │
│  │  │  Manager │ │  Spawner │ │   (JSONL sync)   │    │    │
│  │  └──────────┘ └──────────┘ └──────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Claude  │  │  Claude  │  │  Claude  │
        │  Code    │  │  Code    │  │  Code    │
        │ (Worker) │  │(Planner) │  │(Reviewer)│
        └──────────┘  └──────────┘  └──────────┘
              │             │             │
              └─────────────┼─────────────┘
                            ▼
                    ┌──────────────┐
                    │ orkestra CLI │
                    │ (state sync) │
                    └──────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │  .orkestra/  │
                    │  tasks.jsonl │
                    └──────────────┘
```

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Desktop Framework | Tauri 2.0 | Lightweight, Rust backend, web frontend |
| Frontend | React + TypeScript | Familiar, fast iteration |
| Backend | Rust | Tauri native, good for process management |
| CLI | Rust (clap) | Single binary, shared code with backend |
| Storage | JSONL files | Git-friendly, human-readable, easy to parse |
| Styling | Tailwind CSS | Fast prototyping |

## Directory Structure

### Application Code
```
orkestra/
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/    # Tauri command handlers
│   │   ├── tasks/       # Task management logic
│   │   ├── agents/      # Agent spawning logic
│   │   └── storage/     # JSONL read/write
│   └── Cargo.toml
├── src/                 # React frontend
│   ├── components/
│   ├── hooks/
│   ├── types/
│   └── App.tsx
├── cli/                 # CLI binary (or same crate)
└── package.json
```

### Project Data (in user's repos)
```
.orkestra/
├── tasks.jsonl          # All tasks (append-only log)
├── epics.jsonl          # Epic definitions
├── config.json          # Project-specific settings
└── agents/              # Agent definitions (optional override)
    ├── planner.md
    ├── worker.md
    └── reviewers/
        └── security.md
```

### Default Agent Definitions
```
~/.orkestra/
└── agents/              # Default agent definitions
    ├── planner.md
    ├── worker.md
    └── reviewers/
        ├── security.md
        └── simplicity.md
```

## Data Models

### Epic
```typescript
interface Epic {
  id: string;              // EPIC-001
  title: string;
  description: string;
  status: 'active' | 'completed' | 'archived';
  branch?: string;         // Associated git branch
  pr_url?: string;         // Associated PR
  created_at: string;      // ISO timestamp
  updated_at: string;
}
```

### Task
```typescript
interface Task {
  id: string;              // TASK-001
  epic_id?: string;        // Parent epic
  parent_task_id?: string; // For sub-tasks
  title: string;
  description: string;
  status: TaskStatus;
  agent_type?: AgentType;  // planner | worker | reviewer
  agent_session_id?: string;
  context: TaskContext;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  error?: string;          // If failed
}

type TaskStatus =
  | 'unscoped'           // Just created, needs planning
  | 'planning'           // Planner agent working
  | 'planned'            // Plan ready, awaiting approval
  | 'approved'           // Human approved, ready for work
  | 'in_progress'        // Worker agent working
  | 'ready_for_review'   // Work done, needs review
  | 'reviewing'          // Reviewer agent working
  | 'changes_requested'  // Reviewer found issues
  | 'approved_for_merge' // Reviewer approved
  | 'done'               // Completed
  | 'failed'             // Agent failed (red state)
  | 'blocked'            // Agent reported blocker

interface TaskContext {
  files?: string[];        // Relevant file paths
  plan?: string;           // The approved plan
  related_tasks?: string[];
  review_feedback?: ReviewFeedback[];
  agent_notes?: string;    // Notes from agent
}

interface ReviewFeedback {
  reviewer: string;        // e.g., "security", "simplicity"
  status: 'approved' | 'changes_requested';
  comments: string;
  sub_tasks?: string[];    // Created sub-task IDs
}
```

### Agent Definition
```markdown
# Agent: Worker

## Role
You are a code implementation agent. You receive tasks with clear requirements and implement them.

## Behavior
- Read the task description and context carefully
- Implement the requested changes
- Run tests if available
- When complete, run: `orkestra task complete {TASK_ID} --summary "..."`
- If blocked, run: `orkestra task block {TASK_ID} --reason "..."`
- If failed, run: `orkestra task fail {TASK_ID} --reason "..."`

## Constraints
- Do not ask questions. Make reasonable decisions.
- Stay focused on the specific task.
- Document any assumptions you make.

## Context Provided
- Task description
- Epic context (if any)
- Relevant file paths
- Previous task history in epic
```

## Agent Execution

### Spawning an Agent
```rust
// Pseudocode
fn spawn_agent(task: &Task, agent_def: &AgentDefinition) -> AgentProcess {
    let prompt = build_prompt(task, agent_def);

    let process = Command::new("claude")
        .args(["--print", "--dangerously-skip-permissions"])
        .stdin(prompt)
        .current_dir(&project_path)
        .spawn();

    AgentProcess {
        task_id: task.id,
        process,
        started_at: now(),
    }
}
```

### Agent Prompt Template
```
{agent_definition}

---

## Your Task

**Task ID**: {task.id}
**Title**: {task.title}

### Description
{task.description}

### Epic Context
{epic.description}

### Relevant Files
{task.context.files}

### Previous Work in This Epic
{related_task_summaries}

---

Remember: When done, run `orkestra task complete {task.id} --summary "what you did"`
```

## CLI Commands

```bash
# Task management (for agents)
orkestra task complete TASK-123 --summary "Implemented feature X"
orkestra task fail TASK-123 --reason "Could not find dependency"
orkestra task block TASK-123 --reason "Need clarification on requirements"
orkestra task add-note TASK-123 --note "Decided to use approach X because..."

# Task management (for humans)
orkestra task list [--status STATUS] [--epic EPIC-ID]
orkestra task show TASK-123
orkestra task create --title "..." --description "..." [--epic EPIC-ID]
orkestra task approve TASK-123
orkestra task reject TASK-123 --reason "..."

# Epic management
orkestra epic list
orkestra epic create --title "..." --description "..."
orkestra epic show EPIC-001

# Status
orkestra status  # Show active agents, task counts by status
```

## File Watching & Sync

The Tauri backend watches `.orkestra/tasks.jsonl` for changes:
- When CLI writes new entries, UI updates automatically
- Enables agents to update state without IPC complexity
- Uses `notify` crate for efficient file watching

## State Machine

```
                    ┌──────────────────────────────────────────────────────┐
                    │                                                      │
                    ▼                                                      │
┌─────────┐    ┌──────────┐    ┌────────┐    ┌──────────┐    ┌───────────┐
│ unscoped│───▶│ planning │───▶│ planned│───▶│ approved │───▶│in_progress│
└─────────┘    └──────────┘    └────────┘    └──────────┘    └───────────┘
                    │              │                               │
                    │              │                               ▼
                    │              │                        ┌────────────────┐
                    │              │                        │ready_for_review│
                    │              │                        └────────────────┘
                    │              │                               │
                    │              │         ┌─────────────────────┤
                    │              │         │                     ▼
                    │              │         │              ┌───────────┐
                    │              │         │              │ reviewing │
                    │              │         │              └───────────┘
                    │              │         │                     │
                    │              │         │         ┌───────────┴───────────┐
                    │              │         │         ▼                       ▼
                    │              │         │  ┌──────────────────┐  ┌─────────────────┐
                    │              │         │  │changes_requested │  │approved_for_merge│
                    │              │         │  └──────────────────┘  └─────────────────┘
                    │              │         │         │                       │
                    │              │         │         │                       ▼
                    │              │         │         │                   ┌──────┐
                    │              │         └─────────┘                   │ done │
                    │              │                                       └──────┘
                    ▼              ▼
              ┌──────────┐   ┌─────────┐
              │  failed  │   │ blocked │
              └──────────┘   └─────────┘

Any state can transition to 'failed' or 'blocked'
```

## Security Considerations

- Agents run with `--dangerously-skip-permissions` (user accepts risk)
- CLI validates task IDs belong to current project
- No network communication except git operations
- All data stored locally in user-controlled directories
