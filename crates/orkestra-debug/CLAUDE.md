# orkestra-debug

Debug logging with two channels routed via the `orkestra_debug!` macro.

## Structure

Single-file crate — all code lives in `src/lib.rs`.

## Key Concepts

**Two channels, different purposes:**
- `debug` — Development logging, env-gated, outputs to file + stderr + hook
- `agents` — Agent output capture, always-on, file only (no stderr, no hook)

**Initialization is required:**
```rust
// At app startup
init(orkestra_dir);           // Debug channel
init_agent_log(orkestra_dir); // Agents channel
```

**Hook system for real-time dispatch:**
```rust
set_hook(|component, message| {
    // Called for every debug log (not agents)
    emit_tauri_event(component, message);
});
```

## Internals

- Channels use `OnceLock<LogChannel>` — can only be initialized once
- Hook uses `OnceLock<Mutex<Box<dyn Fn>>>` — only one hook allowed
- Log rotation: 5MB max, keeps last 2MB, finds newline boundary to avoid partial lines

## Usage Patterns

```rust
// Debug logging (gated by ORKESTRA_DEBUG=1)
orkestra_debug!("orchestrator", "Starting tick loop");
orkestra_debug!("session", "Created {} for task {}", id, task);

// Agent output logging (always enabled)
orkestra_debug!("task/planning", target: agents, "{}", log_entry_json);
```

## Gotchas

- **Must init before logging** — calls to `orkestra_debug!` before `init()` are silently dropped
- **One hook only** — subsequent `set_hook()` calls are ignored (OnceLock)
- **Don't call `log()` directly** — use the macro, which checks `is_active()` first

## Anti-patterns

```rust
// Wrong: calling log functions directly
log("comp", "msg");  // Bypasses active check

// Wrong: forgetting to init agents channel
init(dir);  // Debug only
// Missing: init_agent_log(dir);
// Result: all target: agents logs silently dropped
```
