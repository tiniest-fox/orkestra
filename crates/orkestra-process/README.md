# orkestra-process

Process lifecycle management for Orkestra agent processes.

## Purpose

This crate provides process spawning, monitoring, and cleanup utilities. It handles the low-level concerns of managing agent CLI processes: spawning with correct stdio configuration, tracking liveness, collecting output, and ensuring cleanup on exit or panic.

## Key Types

### ProcessSpawner (trait)

Port for spawning agent processes. Implementations exist for different backends:
- `ClaudeProcessSpawner` — spawns `claude` CLI (in orkestra-agent)
- `OpenCodeProcessSpawner` — spawns `opencode` CLI (in orkestra-agent)
- `MockProcessSpawner` — returns configured output for testing

```rust
pub trait ProcessSpawner: Send + Sync {
    fn spawn(&self, working_dir: &Path, config: ProcessConfig) -> Result<ProcessHandle, ProcessError>;
}
```

### ProcessHandle

Handle to a spawned process with stdin/stdout access:
- `write_prompt()` — write to stdin and close it
- `read_line()` / `lines()` — read stdout
- `take_stderr()` — get stderr for separate handling
- `disarm()` — prevent cleanup on drop (call when process exits normally)

### ProcessGuard

RAII guard that kills the process tree on drop. Provides panic safety — if code takes an unexpected path, the process still gets cleaned up.

```rust
let guard = ProcessGuard::new(pid);
// ... do work ...
guard.disarm(); // Process exited normally, don't kill
```

### ProcessConfig

Spawn configuration:
- `session_id` — session identifier for resume support
- `is_resume` — whether to resume an existing session
- `json_schema` — schema for structured output
- `model` — model identifier (provider-specific)
- `system_prompt` — optional system prompt
- `disallowed_tools` — tool patterns to restrict

## Key Functions

```rust
// Kill a process and all its descendants
kill_process_tree(pid: u32) -> io::Result<()>

// Check if a process is still running
is_process_running(pid: u32) -> bool

// Spawn background thread to collect stderr lines
spawn_stderr_reader(stderr: Option<ChildStderr>) -> Option<JoinHandle<Vec<String>>>

// Parse streaming JSON events from agent output
parse_stream_event(json_line: &str) -> ParsedStreamEvent
```

## Feature Flags

- `testutil` — enables `MockProcessSpawner` and `SpawnCall` for testing

## Dependencies

- `serde_json` — parsing streaming JSON events
- `libc` (Unix only) — process signals and tree killing
