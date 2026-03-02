---
date: 2026-03-02
category: process-management
tags: [tauri, process-registry, atomics, arc-injection, rust]
severity: medium
module: src-tauri
symptoms: [process-lifecycle, pid-recycling, log-flush-race, global-static]
---

# Run Process Registry — Design Patterns and Known Debt

Captures design decisions and unresolved technical debt from the run script feature
(`src-tauri/src/run_process.rs`).

## Design Decisions

### stop() Retains Registry Entry (Don't Remove)

`stop()` calls `get()` on the entry rather than `remove()`. The entry stays alive until the
background waiter thread removes it after confirming exit.

**Why:** The frontend calls `get_run_logs()` immediately after `stop_run_script()` to drain
trailing output. If `stop()` removed the entry, the subsequent `get_run_logs` would find no
entry and return nothing — silently dropping the last few lines of output.

**Pattern:** In a stop-then-read sequence, the producer (process) must stay registered until
the consumer (log reader) has finished. The waiter thread owns the removal.

### TOCTOU Fix: Combine total_lines + output into LogBuffer

Reading `total_lines` and `output` as separate operations left a window where the log could
grow between the two reads, returning a stale line count. Fix: wrap both in a single `LogBuffer`
struct and hold the mutex for one atomic read.

### Global Static → Arc Injection

`RUN_PIDS` was initially a `Lazy<Mutex<HashMap>>` global static. This violated Explicit
Dependencies (principle #3) — callers couldn't inject a test double or inspect state without
reaching for global state. Fix: inject `Arc<RunProcessRegistry>` through the call chain:
`ProjectRegistry → ProjectState → RunProcessRegistry`.

The signal handler still needs `kill_all_pids` as a free function (it has no registry access),
so the function is kept as `pub(crate)` but separated from registry state.

## Known Technical Debt (Unresolved After Review Cycle 3)

These were downgraded from HIGH to observation in cycle 3 (proportional rejection rule) but
are Priority 1 quality improvements:

### 1. Ordering::Relaxed on exited in Drop

**File:** `src-tauri/src/run_process.rs`, `RunProcessHandle::drop()`

The `exited` field is an `AtomicBool`. The waiter thread stores `true` with `Relaxed` and
`Drop` reads it with `Relaxed`. On weakly-ordered architectures, `Drop` could observe stale
`false` and send SIGTERM to a recycled PID.

**Fix:** Use `Release` in the waiter's `store` and `Acquire` in `Drop`'s `load` (and all
other callsites that branch on `exited`).

```rust
// Waiter thread:
handle.exited.store(true, Ordering::Release);

// Drop impl:
if !self.exited.load(Ordering::Acquire) {
    // kill
}
```

### 2. PIDs Not Cleaned from run_pids in stop()

**File:** `src-tauri/src/run_process.rs`, `stop()` and `stop_all()`

After `stop()` kills a process, its PID remains in `run_pids` until the waiter thread
asynchronously removes it. If the signal handler fires in that window, it sends SIGTERM to
a potentially-recycled PID.

**Fix:** Remove the PID from `run_pids` in `stop()` after confirming kill, and clear
`run_pids` in `stop_all()` after draining.

## Frontend: Single Hook Instance

`useRunScript` was initially instantiated in both `DrawerHeader` and `RunTab`, creating two
independent polling loops for the same task. Fix: instantiate once in `TaskDrawerBody` and
pass the result down.

**Pattern:** Polling hooks that own server state belong at the lowest common ancestor of all
consumers — not at each leaf component.

## Related Code

- `src-tauri/src/run_process.rs` — `RunProcessRegistry`, `RunProcessHandle`, `kill_all_pids`
- `src-tauri/src/commands/run_script.rs` — Tauri commands wrapping the registry
- `src/hooks/useRunScript.ts` — Frontend polling hook (single instance in `TaskDrawerBody`)
- `src/providers/ProjectInfoProvider.tsx` — Context provider pattern (replaces duplicate fetches)
