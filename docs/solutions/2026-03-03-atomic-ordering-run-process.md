---
date: 2026-03-03
tags: [rust, concurrency, tauri, atomics]
category: bug
module: src-tauri
symptoms:
  - SIGTERM sent to recycled PID after process exits on Apple Silicon
  - Process guard kills wrong process (waiter exited, PID reused by OS)
---

# Ordering::Relaxed on exited AtomicBool in run_process.rs

## Problem

`src-tauri/src/run_process.rs` uses `AtomicBool` to signal that a watched process has exited, but all loads and stores use `Ordering::Relaxed`. On arm64 (Apple Silicon), the `Relaxed` store in the waiter thread may not be visible to the `Drop` or `stop()` loads before they call `kill_process_tree()`.

**Risk:** `kill_process_tree()` is called on a PID that has already exited. If the OS has recycled that PID, the signal hits a different, unrelated process.

## Affected Lines

- **Line 186** — waiter thread stores `true` with `Relaxed` after process exits
- **Line 54** (`Drop`) — loads `exited` with `Relaxed` before calling `kill_process_tree()`
- **Lines 223–225** (`stop()`) — loads `exited` with `Relaxed` before calling `kill_process_tree()`

## Fix

```rust
// Line 186 — waiter thread:
self.exited.store(true, Ordering::Release);

// Line 54 — Drop impl:
if !self.exited.load(Ordering::Acquire) {

// Lines 223-225 — stop():
if self.exited.load(Ordering::Acquire) {
```

`Release` on the store establishes a happens-before edge with `Acquire` on the loads, ensuring the store is visible before the load proceeds to kill the process.

## Notes

- This is pre-existing code, not introduced by any recent PR. It was spotted during review of the Phase 4 remote control task (painfully-utmost-thrasher).
- `x86_64` has a strong memory model where `Relaxed` and `SeqCst` are equivalent for loads/stores, which is why this has not manifested — it is latent on Apple Silicon (`arm64`).
