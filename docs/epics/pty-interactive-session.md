# Plan: PTY-Driven Interactive Claude Code Sessions

## Goal

Replace direct `claude -p --output-format json` invocation (moving to a different
billing model) with a **PTY-driven interactive session** — same headless
automation, but billed as an interactive session and able to reuse one
continuous conversation across turns (warm prompt cache, retained context).

All four prototype questions below were confirmed live on macOS with
claude 2.1.161 using a detached tmux session as the PTY stand-in.

## Validated Approach

### 1. Run a headless interactive session

`claude` runs fine in a detached PTY with no human terminal attached. The
prototype used tmux; **production should use the Rust `portable-pty` crate**
(from wezterm) to own the PTY master directly and drop the tmux dependency.

```
claude --session-id <uuid> --permission-mode acceptEdits --settings '<inline-hooks-json>'
```

### 2. Inject prompts

Write keystrokes to the PTY master fd. (tmux equivalent: `send-keys -l '<text>'`
then a *separate* `send-keys Enter`.) Multi-turn works with full context
retention. Always inject prompt text **literally** so words like "Enter" or
"Space" aren't interpreted as key names.

### 3. Read structured content

Claude Code writes a live transcript at:

```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```

One JSON event per line (`user` / `assistant` / `system`, with content blocks
and token usage) — equivalent data to `--output-format json`. Launch with
`--session-id $(uuidgen)` so the transcript path is **deterministic** instead of
diffing the directory to discover the filename. (The file appears lazily, only
after the first message — another reason to pin the id.)

### 4. Trigger reads on content changes

Watch the JSONL with kqueue (the `notify` crate; the prototype used `tail -F`).
Appends flush within ~2s of a turn completing.

## Lifecycle = Hooks, Not JSONL Parsing

Inject hooks via `--settings` (accepts an inline JSON string **or** a file path).
**Hooks aggregate across settings sources** — the project's own
`.claude/settings.json` hooks still fire alongside ours, so this is a clean
overlay that pollutes no settings file in the repo. Verified: both a project
`Stop` hook and a `--settings` `Stop` hook fired in the same turn.

> Only put hooks in the inline JSON. Do **not** pass scalar settings (`model`,
> etc.) — those follow precedence and would clobber user preferences, whereas
> hook lists merge.

- **`Stop` hook** → fires when a turn completes. Payload includes `session_id`,
  `transcript_path`, `last_assistant_message`, and `stop_hook_active` (guards
  re-fire loops). This is the robust turn-done signal — no need to heuristically
  detect completion from the JSONL (it has no explicit result terminator).
- **`SessionEnd` hook** → fires when the session ends, with a `reason` field
  (e.g. `prompt_input_exit`, `clear`, `logout`).
- **`Notification` hook** → fires on permission requests; useful for detecting a
  session stuck awaiting approval.

Point each hook `command` at a tiny `ork`-internal notifier (or `curl` to a
local socket the orchestrator listens on) rather than appending to files.
Correlate the callback via an `ORK_TASK_ID` env var (hooks inherit the spawned
process's environment) plus the payload's `session_id`.

## Process Model: Kill-and-Resume

Kill the process on session end / between iterations; resume with
`claude --resume <session-id>` in a fresh PTY **from the same worktree cwd**.
Verified: context (a codeword set before the kill) survived process death and
the resumed session appended to the same transcript file.

Rationale:

- **Billing is identical to keep-alive.** Prompt cache is server-side,
  prefix-keyed, with a ~5-minute TTL — process liveness is irrelevant. A
  kept-alive but idle session pays full input rate on its next turn just like a
  resumed one. Keep-alive only saves ~3–5s of startup latency.
- **Matches Orkestra's existing model.** The orchestrator already treats
  iterations as discrete spawns with PID tracking, zombie cleanup, and startup
  recovery (`startup.rs`, `cleanup.rs`). A long-lived idle process is a *new*
  failure class (health checks, hang detection); dead-with-state-on-disk is the
  recovery model already built.
- **Crash recovery is free.** Durable state is the JSONL + the DB. Daemon
  restart mid-task → `--resume` and continue.

Refinement: keep the PTY alive *within a burst* of back-to-back prompts in one
active stage; kill across any human gate (approval/rejection waits, which can be
minutes-to-days) or unknown wait. Don't add a timer-based "keep warm" window —
that's complexity chasing a few seconds of latency.

`--resume` resolves the session from the cwd's project directory, so always
resume from the same worktree path the session started in — Orkestra guarantees
this by construction (stable worktree per task).

## Known Caveats / Open Items

- **First-launch dialogs.** A fresh cwd shows a folder-trust picker (dismiss
  with `Enter`; detect via screen capture / PTY read). Real worktrees derive
  from an already-trusted repo, but trust is keyed by *path* — **test a fresh
  `.orkestra/.worktrees/<task-id>` path** to confirm no prompt appears. If it
  does, dismiss once at worktree creation.
- **JSONL format stability.** The transcript schema is an internal artifact, not
  a documented API. Pin/test against claude versions and keep the parsing layer
  thin and isolated so a format change is a one-file fix. Prefer hooks (the
  documented, stable interface) for control flow; use the JSONL only for content.

## One-Command Launch Recipe

```
[PTY] claude --session-id <uuid> \
             --permission-mode <mode> \
             --settings '{"hooks":{"Stop":[...],"SessionEnd":[...]}}'

  → Stop hook       : notify orchestrator "turn done" + transcript_path
  → SessionEnd hook : notify orchestrator "session over" + reason
  → on signal       : read/parse JSONL for content
  → next iteration  : claude --resume <uuid>   (same cwd)
```
