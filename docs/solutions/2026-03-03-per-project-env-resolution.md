---
title: Per-Project PATH Resolution Architecture
date: 2026-03-03
tags: [env, spawner, agent, process, PATH]
category: architecture
module: orkestra-agent
symptoms:
  - agents inherit stale or version-locked PATH from app startup
  - mise/asdf shims not active for agents in project-specific worktrees
  - env resolution questions for spawner changes
---

# Per-Project ENV Resolution

## Problem

`fix_path_env::fix()` ran once at app startup, capturing the login shell PATH into
the process environment. All agents shared this PATH regardless of their project's
`.mise.toml` or `.tool-versions`. Version-locked paths like
`~/.local/share/mise/installs/node/23.7.0/bin` leaked across projects.

## Solution

Each agent/script spawn resolves the environment fresh from a login shell run in the
project root via `resolve_project_env()`. The full env (not just PATH) is captured
to ensure tool managers, virtual envs, and other shell-managed state is active.

## Canonical Entry Point

**`resolve_agent_env(project_root, shell: Option<&str>) -> Option<HashMap<String, String>>`**
in `crates/orkestra-agent/src/lib.rs`.

This is the single composition function for env resolution. Both call sites use it:
- `execute_agent.rs` — agent spawning
- `spawn_script.rs` — script stage spawning

Do not duplicate the SHELL→resolve→prepend pattern at call sites. Call `resolve_agent_env()`.

## Always-Required Env Vars (Survive `env_clear`)

Some vars must be set regardless of what the project env resolves to. Set these
**outside** the `if let Some(env) = resolved_env` block so they apply on both
paths (resolved env + env_clear, or inherited env):

```rust
// In claude.rs — ALWAYS set outside the if/else
cmd.env("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1");

// Then optionally replace env:
if let Some(env) = resolved_env {
    cmd.env_clear();
    for (k, v) in &env {
        cmd.env(k, v);
    }
}
```

The ORKESTRA_* overlay vars (ORKESTRA_TASK_ID, etc.) go inside the resolved env
block since they augment the fresh env.

## Process Group on Shell Spawn

The login shell subprocess must use `process_group(0)` so it can be killed as a
group on timeout. Kill the group (`kill_process_tree`), not just the PID:

```rust
cmd.process_group(0);
// On timeout/error:
kill_process_tree(child.id().unwrap_or(0));
```

## Follow-Up Items (Not Done in This Task)

- **Remove `pub use resolve_project_env` and `pub use prepend_cli_dir`** from
  `lib.rs:37-38`. Only `resolve_agent_env` belongs on the public API surface.
- **`prepare_path_env()` vs `prepend_cli_dir()` duplication** in `cli_path.rs:60-74`.
  Two functions for one concept. `prepare_path_env` is used only in spawner fallback
  paths — implement one in terms of the other or extract shared logic.
- **Non-zero shell exit silently discards output** (`resolve_project_env.rs:86-98`).
  Shell may exit non-zero due to `.zshrc` hook failure even after `env -0` succeeded.
  Consider: proceed with output when `output_bytes` is non-empty, log exit status at WARN.
- **Thread leak on timeout** (`resolve_project_env.rs:47-52`). `JoinHandle` discarded;
  join it on all exit paths.
- **Duplicated kill-and-wait in error arms** (`resolve_project_env.rs:54-83`).
  Extract `kill_and_cleanup(child)` private helper.
- **`assistant/service.rs`** still uses `prepare_path_env()` rather than
  `resolve_agent_env()`. Not updated in this task.
- **Caching env resolution per project root** — login shell env is stable within a
  process lifetime. A `HashMap<PathBuf, HashMap<String, String>>` cache would eliminate
  repeat shell spawns and the synchronous-blocking concern.
