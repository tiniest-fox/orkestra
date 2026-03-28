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
| `human_actions.rs` | Approve, reject, answer questions, retry, auto-mode, interrupt, resume | `registry.with_project(label, |state| state.api.method())` |
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
- Frontend receives these as JS objects in catch blocks (Tauri 2 delivers them pre-parsed)

## Startup Logging Constraint

`orkestra_debug!` is **not available** during Tauri's early startup (before the first project is opened). The debug logger is initialized lazily in `project_init.rs` when a project first opens. Code that runs at app startup — such as `fix_path_env::fix()` in `lib.rs::run()` — must use `eprintln!` for logging instead.

The pattern for deferring early startup messages to the debug log: store the result in a `OnceLock`, then replay it in `project_init.rs` once logging is initialized. Only the first project open replays the message (subsequent `OnceLock::get()` calls return the already-set value but the replay guard skips them). This is intentional — the message is only relevant once.

This asymmetry with the daemon (which has `tracing` available immediately from startup) is by design — Tauri's lifecycle requires a project to be open before the logger is initialized.

<!-- compound: boorishly-profitable-cat -->
## Embedded SPA Serving

When serving multiple Vite bundles (e.g., main PWA + service manager), each bundle has its own HTML entry file. `embedded_spa.rs`'s `serve_embedded_file` accepts a `root_file: &str` parameter — callers pass the correct filename for their bundle:

- `pwa.rs` → `"index.html"` (from `dist/`)
- `service_ui.rs` → `"service.html"` (from `dist-service/`)

**Do not hardcode `"index.html"`** in `serve_embedded_file` — it silently 404s for any bundle whose Vite output file has a different name. This contract is stringly-typed and only surfaces at runtime (rust_embed resolves at compile time), so it won't be caught by unit tests.

When adding a new embedded bundle: (1) check what filename Vite outputs in `vite.config.ts`, (2) pass that exact string to `serve_embedded_file`.

<!-- compound: exactly-above-mako -->
## Frontend Build-Time Values

**`src-tauri/build.rs` cannot inject env vars into the frontend build.** Tauri's `beforeBuildCommand` (which runs `pnpm build`) executes before `build.rs` runs — by the time `build.rs` sets an env var, the Vite build is already done.

To inject a build-time value into the frontend (e.g., git commit hash, version):
- Resolve it in `vite.config.ts` using the `define` option (statically replaces `import.meta.env.VITE_*` at build time)
- Example: `execSync('git rev-parse --short HEAD')` inside `vite.config.ts`, then `define: { 'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(hash) }`

This covers all build paths (service, Tauri, local dev) in one place.

## Key Files

| File | Role |
|------|------|
| `lib.rs` | App entry point: window lifecycle, signal handlers, notification handling, window close cleanup |
| `project_registry.rs` | `ProjectRegistry`: per-window project state isolation with `HashMap<label, ProjectState>` |
| `project_init.rs` | Project initialization: `.orkestra` creation, workflow copying, database setup |
| `commands/project.rs` | Project commands: `open_project`, recent projects, folder picker, orchestrator lifecycle |
| `error.rs` | `TauriError` with `From<WorkflowError>` conversion and error code table |
| `commands/mod.rs` | Command re-exports |
