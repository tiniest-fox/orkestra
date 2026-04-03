# Architecture Reference

Deep reference documentation for Orkestra's runtime architecture. Read these sections when working in the relevant areas — they are detailed enough to stand alone without the root CLAUDE.md.

For the module structure conventions and architectural principles that apply everywhere, see the root `CLAUDE.md`.

---

## Devcontainer Architecture

Orkestra uses a two-layer container model. Understanding the boundary between them is critical when making changes to either layer.

**Layer 1 — The project devcontainer (`.devcontainer/Dockerfile`)**

This image is the project's own development environment. It must work identically in GitHub Codespaces, VS Code Dev Containers, and Orkestra — it has no knowledge that Orkestra exists. Rules:

- Install tools globally with **world-writable permissions** (`chmod -R a+rwX`) so any non-root user can write to tool caches at runtime. Never use `chown` with a specific uid — the uid is unknown at build time and varies by environment.
- Do not reference uid 1000, `/home/orkestra`, or any Orkestra-specific path.
- Pre-fetch expensive dependency caches (e.g. `cargo fetch --locked`) at build time to avoid runtime permission races.

**Layer 2 — The Orkestra toolbox (`crates/orkestra-service/Dockerfile.toolbox` + `setup.sh`)**

The toolbox is Orkestra's adapter: it runs inside *any* project container (including ones that have never heard of Orkestra) and configures it for Orkestra's runtime needs. `setup.sh` executes as root at container startup via `docker exec`. Rules:

- All Orkestra-specific configuration belongs here, not in the project devcontainer.
- `setup.sh` is the right place for: resolving/creating uid 1000, git identity, tool store paths (e.g. pnpm `store-dir`), and any other per-user setup.
- Toolbox changes require bumping `TOOLBOX_VERSION` in `crates/orkestra-service/src/interactions/devcontainer/ensure_toolbox_volume.rs` to trigger a volume rebuild.

**Decision rule:** If a change would break the devcontainer in Codespaces or a local VS Code setup, it belongs in the toolbox, not the devcontainer.

---

## Configurable Workflow System

Tasks progress through an ordered list of stages defined in `StageConfig` structs (`workflow/config/stage.rs`). The workflow is loaded from `.orkestra/workflow.yaml` by `load_workflow_for_project()` in `workflow/config/loader.rs`. The file must exist — `ensure_orkestra_project()` creates it on first init.

**Key domain types** (`workflow/config/`):

- **`WorkflowConfig`** (`workflow.rs`) — Map of named flows. Every pipeline is a flow; there is no separate global stage list. Validated on load (unique stage/artifact names per flow).
- **`StageConfig`** (`stage.rs`) — A stage has a `name`, `artifact` (output name), `capabilities`, optional `model` (provider/model spec like `"claudecode/sonnet"`), optional `gate` (`GateConfig` with a `command` and optional `timeout_seconds` — runs after the agent completes; non-zero exit re-queues the agent with error output as feedback), and either a `prompt` (agent stage) or `script` (script stage). Agent stages default to `.orkestra/agents/{name}.md` when no explicit prompt is set. Artifacts from earlier stages are automatically available to all later stages.
- **`StageCapabilities`** (`stage.rs`) — Flags that control what output types the stage's JSON schema includes: `ask_questions`, `subtasks: Option<SubtaskCapabilities>` (with `flow` and `completion_stage`), `approval: Option<ApprovalCapabilities>` (with optional `rejection_stage`).
- **`ScriptStageConfig`** (`stage.rs`) — Shell command, timeout, optional `on_failure` stage for recovery.
- **`FlowConfig`** (`workflow.rs`) — A complete pipeline. Has a `description`, an ordered list of `StageConfig`s (full definitions, not references), and a required `integration: IntegrationConfig` for per-flow integration settings (e.g., `on_failure`).

**Runtime types** (`workflow/runtime/`, `workflow/domain/`):

- **`Phase`** — Current execution state: `Idle`, `SettingUp`, `AgentWorking`, `AwaitingReview`, `Interrupted`, `Integrating`.
- **`Iteration`** — Each agent/script run within a stage. Rejections create new iterations with feedback.
- **`Artifact`** — Named output content stored on the task, keyed by artifact name.

### How Stages Execute

See [`docs/flows/stage-execution.md`](flows/stage-execution.md) for the full execution flow. In brief: the `OrchestratorLoop` runs a 100ms tick loop that polls completed agents, processes their output, starts new executions for idle tasks, and triggers integration for done tasks. Agent stages get a dynamically built prompt + JSON schema; script stages run via `sh -c` in the worktree.

### Adding a New Stage

To add a stage to this project's workflow:

1. Create a prompt template at `.orkestra/agents/{agent_type}.md`
2. Add the stage entry to `.orkestra/workflow.yaml`
3. No Rust changes needed — the config loader, schema generator, and orchestrator handle it generically

The standard workflow template (created by `ensure_orkestra_project()` on init) defines a `default` flow: `planning → breakdown → work → review`. This project's `.orkestra/workflow.yaml` defines four flows: `default` (plan → task → work → review → compound), `quick` (plan → work → review → compound), `hotfix` (work → review), and `micro` (work only).

### Flows (Alternate Pipelines)

Flows are the primary unit of workflow configuration — every pipeline is a named flow with its own complete set of `StageConfig`s and `IntegrationConfig`. Tasks always have an assigned flow (`"default"` if not explicitly set).

Key behaviors:
- Each flow contains complete `StageConfig` definitions (not references to global stages)
- Stage navigation (`first_stage(flow)`, `next_stage(flow, current)`) respects each flow's stage list
- Approval `rejection_stage` targets and script `on_failure` targets must be within the flow's stage list
- YAML anchors (`&anchor`/`*alias`) can share identical stage blocks across flows without duplication

### Subtask System

See [`docs/flows/subtask-lifecycle.md`](flows/subtask-lifecycle.md) for the full lifecycle. In brief: stages with `subtasks` capabilities output subtask JSON. On approval, `SubtaskService` creates child tasks with dependencies, flow assignment (via `subtasks.flow`), and inherited artifacts. Parent enters `WaitingOnChildren` until all subtasks complete, then advances to `subtasks.completion_stage` if configured. Each subtask gets its own worktree and branch, created from the parent's branch when its dependencies are satisfied.

---

## Agent System

Agents are spawned via a **provider registry** that supports multiple CLI backends. Each stage can specify a `model` field (e.g., `claudecode/sonnet`, `opencode/kimi-k2`) to select a provider and model. The `ProviderRegistry` (`workflow/execution/provider_registry.rs`) resolves model specs to a `ProcessSpawner` implementation with provider-specific capabilities.

**Supported providers:**
- **claudecode** (default) — Claude Code CLI. Supports `--json-schema` for structured output and `--resume` for session recovery. Aliases: `sonnet`, `opus`, `haiku`.
- **opencode** — OpenCode CLI (`opencode run`). Uses `--format json` (no native JSON schema enforcement) and `--continue` for session recovery. Aliases: `kimi-k2`, `kimi-k2.5`.

**Model spec resolution:**
- `None` → default provider's default model
- `"sonnet"` → shorthand, searches all provider alias tables
- `"claudecode/sonnet"` → explicit provider + alias
- `"claudecode/claude-sonnet-4-20250514"` → explicit provider + raw model ID

**Provider capabilities** (`ProviderCapabilities`) affect execution: when `supports_json_schema` is false, the JSON schema is embedded in the prompt text instead of passed as a CLI flag.

Agent prompt templates (in `.orkestra/agents/`):
- **planner.md**: Creates implementation plan, can ask clarifying questions
- **breakdown.md**: Decomposes complex tasks into subtasks with dependencies
- **worker.md**: Implements approved plan, outputs completion/failure/blocked status
- **reviewer.md**: Reviews completed work, approves or requests changes
- **compound.md**: Captures learnings and fixes stale documentation

The prompt builder injects task context (description, artifacts, questions, feedback) into these templates.

Note: Title generation and commit message generation use separate internal templates (in `crates/orkestra-core/src/prompts/templates/` and `crates/orkestra-core/src/utilities/`) since they're utility functions, not configurable stage agents.

**Querying workflow configuration for flow-aware logic:**

When you need model specs for all agent stages in a flow, use `WorkflowConfig::agent_model_specs(task_flow)` rather than directly accessing flow stages. This method encapsulates the flow-aware traversal logic (iterating flow stages, filtering scripts). Example use case: collecting model names for commit attribution — see `commit_message.rs::collect_model_names()`.

### Disallowed Tools

Stages can restrict which tools agents are allowed to use via the `disallowed_tools` configuration. This is useful when automated stages handle certain operations (like the `check` stage running tests/lints) and you want to prevent agents from duplicating that work.

Configuration syntax in `.orkestra/workflow.yaml`:

```yaml
stages:
  - name: work
    artifact: summary
    disallowed_tools:
      - pattern: "Bash(cargo test)"
        message: "Testing is handled by the automated checks stage"
      - pattern: "Bash(cargo build)"
        message: "Building is handled by the automated checks stage"
      - pattern: "Bash(cargo fmt)"
      - pattern: "Bash(cargo clippy)"
```

- **`pattern`**: Tool pattern in Claude Code format (e.g., `Bash(cargo *)`, `Edit(*.lock)`, `Write`)
- **`message`** (optional): Human-readable reason injected into the agent's system prompt

**How restrictions are enforced:**
- **System prompt**: Restriction messages are injected into the agent's system prompt before any tool use, so the agent learns about the restrictions upfront
- **CLI flag** (Claude Code only): Patterns are passed via `--disallowedTools "pattern1,pattern2"` for hard enforcement
- **OpenCode**: Only system prompt injection (no native enforcement support)

**Platform-level invariants** (not user-configurable): The Claude Code spawner (`crates/orkestra-agent/src/interactions/spawner/claude.rs`) unconditionally prepends `EnterPlanMode` and `ExitPlanMode` to `--disallowedTools` for every invocation. These are hardcoded because Claude Code's built-in plan mode conflicts with Orkestra's planning pipeline — this applies to all agent stages and assistant/chat sessions. User-configured restrictions are merged on top. Note: the assistant service (`crates/orkestra-core/src/workflow/assistant/service.rs`) spawns Claude Code directly via its own `Command::new("claude")` and must maintain its own hardcoded disallowed tools string that includes these invariants — it does not go through the spawner.

---

## Process Management

Agent processes are managed with multiple cleanup mechanisms:

- **Signal handlers**: SIGTERM/SIGINT/SIGHUP trigger cleanup before exit
- **Startup orphan cleanup**: Kills any orphaned agents from previous crashes on app start
- **ProcessGuard**: RAII guard that kills processes on drop (defense against panics)
- **Recursive tree killing**: Kills entire process trees including child shells
- **Session-based recovery**: Session IDs are stored in the database before agent spawn. Resume behavior is provider-specific (Claude Code uses `--resume`, OpenCode uses `--continue`).

**Process spawning rules** — when spawning child processes, always:

1. **Pipe all three stdio streams** (`stdin`, `stdout`, `stderr`). Use `Stdio::null()` for stdin if you don't need it, `Stdio::piped()` for stdout/stderr if you're reading output. An inherited stdin on a background process group causes `SIGTTIN` on any read attempt, which **stops the entire process group** silently. An inherited stdout/stderr can block if the parent's pipe buffer fills.
2. **Send `SIGCONT` before `SIGTERM`** when killing processes. Stopped processes (from `SIGTTIN`, `SIGTSTP`, etc.) queue but don't deliver `SIGTERM` — they stay stopped forever. Always continue them first.
3. **Use `process_group(0)`** so child processes form their own group, enabling clean tree kills via `kill(-pgid, signal)`.

---

## Worktree Lifecycle

### Setup

When a new worktree is created for a task, `.orkestra/scripts/worktree_setup.sh` runs automatically. Use this for project-specific setup:

```bash
WORKTREE_PATH="$1"
# Copy .env, run pnpm install, etc.
```

### Cleanup

When a worktree is removed, `.orkestra/scripts/worktree_cleanup.sh` runs automatically before deletion. Use this for project-specific teardown (removing symlinks, stopping dev servers, etc.):

```bash
WORKTREE_PATH="$1"
# Remove symlinks, kill dev servers, etc.
```

**Important:** Cleanup script failures do not block worktree removal — if the script exits non-zero, the error is silently discarded and removal proceeds. This is intentional: a stuck worktree is worse than incomplete cleanup. If the worktree directory no longer exists when removal is triggered, the script is skipped entirely. Add your own logging inside the script if you need visibility into failures.
