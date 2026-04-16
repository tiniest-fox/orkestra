# orkestra-process

Process lifecycle management for agent processes.

## Module Structure

```
src/
├── lib.rs           # Public API re-exports
├── interface.rs     # ProcessSpawner trait
├── types.rs         # ProcessGuard, ProcessHandle, ProcessConfig, ProcessError, ParsedStreamEvent
├── mock.rs          # MockProcessSpawner (feature-gated)
└── interactions/
    ├── tree/
    │   ├── kill.rs        # kill_process_tree() — recursive tree killing
    │   └── is_running.rs  # is_process_running() — liveness check
    ├── io/
    │   └── spawn_stderr_reader.rs  # Background stderr collection
    └── stream/
        └── parse_event.rs  # Parse streaming JSON events
```

## Critical Patterns

### Always Send SIGCONT Before SIGTERM

Stopped processes (from SIGTTIN, SIGTSTP, etc.) queue SIGTERM but don't deliver it. Without SIGCONT first, the kill is silently ignored and the process stays stopped forever.

```rust
// Correct:
unsafe { libc::kill(-pgid, libc::SIGCONT) };  // Wake stopped processes
unsafe { libc::kill(-pgid, libc::SIGTERM) };  // Now SIGTERM is delivered

// Wrong:
unsafe { libc::kill(-pgid, libc::SIGTERM) };  // May be ignored if stopped!
```

### Pipe All Three Stdio Streams

Background processes with inherited stdin get SIGTTIN on any read attempt, which stops the entire process group silently. Always pipe or null stdin.

```rust
// Correct:
Command::new("agent")
    .stdin(Stdio::piped())   // Or Stdio::null()
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .process_group(0)        // Enable tree kills
    .spawn()

// Wrong:
Command::new("agent")
    .spawn()  // Inherits all stdio — SIGTTIN risk!
```

### Use process_group(0) for Tree Kills

Spawning with `process_group(0)` makes the child the leader of its own process group. This enables killing the entire tree via `kill(-pgid, signal)`.

## ProcessGuard Pattern

The guard kills on drop unless disarmed. Use for panic safety:

```rust
let guard = ProcessGuard::new(pid);
// ... agent execution ...
// If we panic here, guard.drop() kills the process
guard.disarm();  // Normal exit — don't kill
```

## Gotchas

- **Tree killing collects descendants first** — child PIDs are gathered before sending signals, because killed processes may reparent orphans to init
- **ESRCH is not an error** — process already exited, which is fine
- **Windows uses taskkill /T** — different mechanism, same tree-kill semantics
- **Zombie processes fool liveness checks** — `kill(pid, 0)` returns `Ok(())` for zombie processes (dead but unreaped), so `process_exists()` will report `true` even after SIGTERM/SIGKILL. In tests, call `child.wait()` to reap the zombie before asserting the process is gone.

## Anti-Patterns

- Don't use inherited stdin/stdout/stderr on background processes
- Don't skip SIGCONT before SIGTERM — stopped processes won't die
- Don't assume SIGTERM delivery — always have SIGKILL fallback
