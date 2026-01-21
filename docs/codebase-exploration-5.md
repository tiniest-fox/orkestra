# Codebase Exploration - Tool Testing Report

This document captures findings from testing the reading tools (Glob, Read, Grep) on the Orkestra codebase.

## Tools Tested

### 1. Glob Tool
Used to discover file patterns across the project.

**Pattern tested:** `src/**/*.{ts,tsx}` - Found 8 frontend files:
- `src/main.tsx` - Application entry point
- `src/App.tsx` - Main application component
- `src/types/task.ts` - TypeScript type definitions
- `src/hooks/useTasks.ts` - Custom React hook for task management
- `src/components/KanbanBoard.tsx` - Kanban board UI
- `src/components/TaskCard.tsx` - Individual task card component
- `src/components/CreateTaskModal.tsx` - Task creation modal
- `src/components/TaskDetailSidebar.tsx` - Task detail sidebar

**Pattern tested:** `crates/**/*.rs` - Found 4 Rust core library files:
- `project.rs` - Project root detection
- `tasks.rs` - Task data structures and persistence
- `agents.rs` - Agent spawning and management
- `lib.rs` - Library exports

### 2. Read Tool
Used to examine file contents in detail.

**Key observations from reading files:**

#### Task Data Model (`src/types/task.ts`)
- 8 possible task statuses: `pending`, `planning`, `awaiting_approval`, `in_progress`, `ready_for_review`, `done`, `failed`, `blocked`
- Task interface includes: `id`, `title`, `description`, `status`, timestamps, optional `summary`, `error`, `logs`, `agent_pid`, `plan`, `plan_feedback`
- Status configuration maps each status to a label and Tailwind CSS color class

#### Task Hook (`src/hooks/useTasks.ts`)
- Uses Tauri's `invoke` API to communicate with Rust backend
- Polls for task updates every 2 seconds (noted as temporary until file watcher)
- Exposes: `tasks`, `loading`, `error`, `createTask`, `updateTaskStatus`, `refetch`
- `createTask` automatically spawns an agent to work on the task

#### Main Application (`src/App.tsx`)
- Single-page Kanban-style interface
- Components: Header with "New Task" button, KanbanBoard, CreateTaskModal, TaskDetailSidebar
- Keeps selected task in sync with latest data from polling

### 3. Grep Tool
Used to search for patterns across files.

**Pattern tested:** `task` in `src/*.ts` - Found `useTasks.ts` which contains all task-related logic

**Pattern tested:** `invoke` in `src-tauri/src` - Found Tauri command handler registration

## Frontend Component Architecture

```
App.tsx
├── KanbanBoard.tsx
│   └── TaskCard.tsx (multiple)
├── CreateTaskModal.tsx
└── TaskDetailSidebar.tsx
```

### KanbanBoard Behavior
- 5 visible columns: Planning, Awaiting Approval, In Progress, Review, Done
- First column (Planning) aggregates: pending, planning, failed, and blocked tasks
- Each column shows task count
- Color-coded status indicators using Tailwind CSS

## Backend (Rust) Architecture

The Rust backend follows a modular design:

1. **Task Persistence** - JSONL append-only format in `.orkestra/tasks.jsonl`
2. **Task Lifecycle Functions:**
   - `create_task()` - Creates new task with auto-generated ID
   - `update_task_status()` - Generic status update
   - `complete_task()` - Marks ready for review with summary
   - `fail_task()` - Marks failed with reason
   - `block_task()` - Marks blocked with reason
   - `set_task_plan()` - Stores plan and moves to awaiting_approval
   - `approve_task_plan()` - Moves from awaiting_approval to in_progress
   - `request_plan_changes()` - Returns to planning with feedback

## Data Flow Patterns

1. **Frontend → Backend**: Via Tauri `invoke()` calls
2. **Task State**: Managed in React state, synced via polling
3. **Persistence**: JSONL file with HashMap-based deduplication on load
4. **Agent Communication**: Agents use CLI (`ork task complete/fail/block`) to report status

## Notable Code Patterns

- **TypeScript**: Strong typing with interfaces and union types for status
- **React**: Functional components with hooks (`useState`, `useEffect`, `useCallback`)
- **Rust**: Result-based error handling, serde for serialization
- **UI State Management**: Local React state with optimistic updates
