# Orkestra MVP

## MVP Definition

The minimum viable product that proves the core concept works. One user (you), one workflow, basic UI.

## Success Criteria

You can:
1. Open the app and see a kanban board
2. Add a task via a form
3. Have a worker agent automatically pick up the task
4. Watch the task move through states
5. See clear indication when something fails (red)
6. Close and reopen the app with all state preserved

## Scope

### In Scope
- Tauri app shell with React frontend
- Kanban board UI (columns for each status)
- Task creation form (title + description)
- JSONL storage for tasks
- `orkestra` CLI with task state commands
- Worker agent spawning via `claude --print`
- File watcher to sync CLI updates to UI
- Basic agent definition (worker only)

### Out of Scope (Phase 2+)
- Planner agent
- Reviewer agents
- Epics (tasks are top-level for now)
- Sub-tasks
- Git/PR integration
- Agent output streaming
- Multiple agent types
- Approval workflows
- Human approval gates

## Simplified State Machine (MVP)

```
┌─────────┐    ┌───────────┐    ┌──────────────────┐    ┌──────┐
│ pending │───▶│in_progress│───▶│ ready_for_review │───▶│ done │
└─────────┘    └───────────┘    └──────────────────┘    └──────┘
                    │
                    ▼
              ┌──────────┐
              │  failed  │
              └──────────┘
```

- `pending`: Task created, waiting for agent
- `in_progress`: Agent is working
- `ready_for_review`: Agent completed (human reviews manually)
- `done`: Human marked as done
- `failed`: Something went wrong

## Technical Breakdown

### 1. Project Setup
- [ ] Initialize Tauri 2.0 project
- [ ] Configure TypeScript + React
- [ ] Set up Tailwind CSS
- [ ] Create basic app shell

### 2. Data Layer
- [ ] Define Task type (Rust + TypeScript)
- [ ] Implement JSONL read/write (Rust)
- [ ] Create file watcher for `.orkestra/tasks.jsonl`
- [ ] Expose Tauri commands: `get_tasks`, `create_task`, `update_task`

### 3. CLI
- [ ] Create `orkestra` CLI binary
- [ ] Implement `orkestra task complete <id> --summary "..."`
- [ ] Implement `orkestra task fail <id> --reason "..."`
- [ ] Implement `orkestra task list`
- [ ] CLI writes to same JSONL file

### 4. Agent Spawning
- [ ] Create worker agent definition markdown
- [ ] Implement prompt builder (task context → prompt string)
- [ ] Implement agent spawner (shell out to `claude --print`)
- [ ] Track running agents (task_id → process)
- [ ] Detect agent completion (process exit)

### 5. UI Components
- [ ] Kanban board layout (4 columns)
- [ ] Task card component (title, status indicator)
- [ ] Task creation modal/form
- [ ] Failed state styling (red border/background)
- [ ] Loading/spinning state for in_progress

### 6. Integration
- [ ] Auto-spawn agent when task enters `pending`
- [ ] Update task status to `in_progress` when agent starts
- [ ] File watcher triggers UI refresh on JSONL change
- [ ] Manual "Mark as Done" button for `ready_for_review` tasks

## File Structure (MVP)

```
orkestra/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri entry point
│   │   ├── commands.rs          # Tauri command handlers
│   │   ├── tasks.rs             # Task CRUD operations
│   │   ├── storage.rs           # JSONL operations
│   │   ├── agents.rs            # Agent spawning
│   │   └── watcher.rs           # File system watcher
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   ├── TaskCard.tsx
│   │   └── CreateTaskModal.tsx
│   ├── hooks/
│   │   └── useTasks.ts
│   ├── types/
│   │   └── task.ts
│   └── index.css                # Tailwind
├── cli/
│   └── main.rs                  # Could be separate crate or part of src-tauri
├── agents/
│   └── worker.md                # Default worker agent definition
├── package.json
└── plans/                       # This folder
```

## Data Model (MVP)

```typescript
interface Task {
  id: string;           // TASK-001
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'ready_for_review' | 'done' | 'failed';
  created_at: string;
  updated_at: string;
  completed_at?: string;
  summary?: string;     // Agent's completion summary
  error?: string;       // If failed
}
```

## Agent Definition (MVP)

```markdown
# Worker Agent

You are a code implementation agent for the Orkestra task system.

## Your Task
{task_description}

## Instructions
1. Read the task carefully
2. Implement the requested changes
3. Test your changes if possible
4. When complete, run this exact command:
   ```
   orkestra task complete {task_id} --summary "Brief description of what you did"
   ```
5. If you cannot complete the task, run:
   ```
   orkestra task fail {task_id} --reason "Why you couldn't complete it"
   ```

## Rules
- Do NOT ask questions. Make reasonable assumptions.
- Stay focused on this specific task.
- Document any significant decisions in the summary.
```

## UI Wireframe

```
┌────────────────────────────────────────────────────────────────────┐
│  Orkestra                                        [+ New Task]      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│  │   Pending   │ │ In Progress │ │   Review    │ │    Done     │  │
│  │             │ │             │ │             │ │             │  │
│  │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │  │
│  │ │ Task 1  │ │ │ │ Task 2  │ │ │ │ Task 3  │ │ │ │ Task 4  │ │  │
│  │ │         │ │ │ │ ◐       │ │ │ │ [Done]  │ │ │ │ ✓       │ │  │
│  │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │  │
│  │             │ │             │ │             │ │             │  │
│  │ ┌─────────┐ │ │             │ │             │ │ ┌─────────┐ │  │
│  │ │ Task 5  │ │ │             │ │             │ │ │ Task 6  │ │  │
│  │ │ ✗ RED   │ │ │             │ │             │ │ │ ✓       │ │  │
│  │ └─────────┘ │ │             │ │             │ │ └─────────┘ │  │
│  │             │ │             │ │             │ │             │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## Next Steps After MVP

Once MVP works:
1. Add planner agent (tasks start as `unscoped`, planner creates plan)
2. Add approval gate (human approves plan before work starts)
3. Add reviewer agent (checks work before marking ready for human review)
4. Add epics to group related tasks
5. Add git branch/PR association
