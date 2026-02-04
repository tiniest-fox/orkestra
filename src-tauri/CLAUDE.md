# Tauri Backend

The Tauri layer is a thin bridge between the React frontend and the `orkestra-core` library. It should contain no business logic — commands acquire the `WorkflowApi` lock, call a method, and return the result.

## Multi-Window Architecture

Each OS window corresponds to one project folder. State is isolated per project via the `ProjectRegistry` (`project_registry.rs`), which maps window labels to `ProjectState` instances. Commands use the window label to route operations to the correct project's API and orchestrator.

## Command Organization

Commands live in `src/commands/`, organized by concern:

| File | Concern | Pattern |
|------|---------|---------|
| `project.rs` | Open projects, recent projects, folder picker, orchestrator lifecycle | `registry.with_project(label, |state| ...)` |
| `task_crud.rs` | Create, read, delete tasks | `registry.with_project(label, |state| state.api.method())` |
| `human_actions.rs` | Approve, reject, answer questions, retry, auto-mode | `registry.with_project(label, |state| state.api.method())` |
| `queries.rs` | Read-only data fetching (iterations, artifacts, config, logs) | `registry.with_project(label, |state| state.api.method())` |
| `external_tools.rs` | Open worktrees in terminal/editor | Shell commands via `tauri-plugin-shell` |

All commands are re-exported from `commands/mod.rs` and registered in `lib.rs`'s `invoke_handler!`.

## Adding a New Command

1. Add the function in the appropriate module (or create a new one if it's a new concern)
2. Annotate with `#[tauri::command]` — Tauri requires owned types for parameters
3. For project-specific commands: Get the API via `registry.with_project(window.label(), |state| state.api.method())?`
4. Return `Result<T, TauriError>` — use `?` with `WorkflowError` (auto-converts via `From` impl in `error.rs`)
5. Re-export from `commands/mod.rs` if new module
6. Register in the `invoke_handler!` macro in `lib.rs`
7. Frontend TypeScript bindings regenerate on build

## State Management

- `ProjectRegistry` (`project_registry.rs`) holds `HashMap<label, ProjectState>` mapping window labels to project state
- Each `ProjectState` contains: `Arc<Mutex<WorkflowApi>>`, workflow config, project root, database connection, and `Arc<AtomicBool>` stop flag
- Commands receive `State<ProjectRegistry>` and `Window` from Tauri's dependency injection
- Use `window.label()` to identify which project's state to access
- The API lock is shared between commands and the orchestrator — hold it briefly
- Recent projects are persisted via `tauri-plugin-store` in the app data directory (separate from project folders)

## Error Handling

- `TauriError` (`error.rs`) wraps `WorkflowError` with structured `{ code, message }` JSON
- Error codes: `TASK_NOT_FOUND`, `INVALID_TRANSITION`, `STORAGE_ERROR`, `LOCK_ERROR`, etc.
- Frontend parses these via `JSON.parse(error)` in catch blocks

## Key Files

| File | Role |
|------|------|
| `lib.rs` | App entry point: window lifecycle, signal handlers, notification handling, window close cleanup |
| `project_registry.rs` | `ProjectRegistry`: per-window project state isolation with `HashMap<label, ProjectState>` |
| `project_init.rs` | Project initialization: `.orkestra` creation, workflow copying, database setup |
| `commands/project.rs` | Project commands: `open_project`, recent projects, folder picker, orchestrator lifecycle |
| `error.rs` | `TauriError` with `From<WorkflowError>` conversion and error code table |
| `commands/mod.rs` | Command re-exports |
