# Orkestra

Orkestra orchestrates AI coding agents to plan and implement software tasks with human oversight. Each Trak gets an isolated git worktree; agents move through configurable stages with approval checkpoints.

## Key Concepts

- **Trak** — A unit of work (internally "task"). Each Trak has a title, description, and progresses through stages.
- **Stage** — A step in the workflow (e.g., planning, work, review). Each stage runs an agent or waits for human input.
- **Flow** — A named sequence of stages defined in `workflow.yaml`.
- **Worktree** — An isolated git worktree created for each Trak so parallel work never conflicts.
- **Agent** — An AI coding assistant (e.g., Claude Code) that executes a stage and produces output for review.
- **Artifact** — The named output a stage produces (e.g., "plan", "summary", "verdict"). Artifacts from earlier stages are automatically available to later stages as context.

## Flows

The default `workflow.yaml` defines two flows:

- **`default`** — Full pipeline: planning → breakdown → work → review → compound. Used for most Traks.
- **`subtask`** — Abbreviated pipeline: work → review only. Used for subtasks created during breakdown.

Custom flows can be added in `workflow.yaml` for different types of work (e.g., a `hotfix` flow that skips planning). YAML anchors (`&name` / `*name`) allow reusing stage definitions across flows — the seeded `workflow.yaml` uses anchors on `work` and `review` so the subtask flow inherits the same configuration.

## Gates

A gate is a shell script that runs after an agent completes a stage. If the gate exits non-zero, the agent retries with the error output as feedback. Gates enforce automated quality checks before work can advance.

The seeded `.orkestra/scripts/checks.sh` is a template — customize it with your project's build, lint, and test commands. The `work` stage uses this gate by default.

Environment variables available to gate scripts:

- `ORKESTRA_PROJECT_ROOT` — Absolute path to the project root
- `ORKESTRA_WORKTREE_PATH` — Absolute path to the Trak's git worktree
- `ORKESTRA_TASK_ID` — The Trak ID

Example `checks.sh` customization:

```bash
#!/bin/bash
set -e
cd "$ORKESTRA_WORKTREE_PATH"
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## Artifacts

Each stage produces a named artifact stored in `.orkestra/.artifacts/` (gitignored). Artifacts from prior stages are automatically passed to later stages as context. For example, the `work` stage receives the `plan` artifact from planning and the `breakdown` artifact from breakdown.

The artifact name is set per stage in `workflow.yaml`:

```yaml
- name: work
  artifact: summary   # the work stage produces a "summary" artifact
  prompt: worker.md
```

## Compound Stage

The default workflow includes an automated compound stage that runs after review. Its job is to capture documentation improvements from the completed Trak — things that took time, caused confusion, or would help future agents. Most Traks result in no changes; the compound agent only acts when there's something genuinely worth documenting.

The compound agent updates `CLAUDE.md` files, agent prompts, and code comments. It never modifies code.

## Integration

After a Trak is approved, Orkestra merges its worktree branch into the main branch. If merging fails (e.g., a conflict), the Trak returns to the stage named in `integration.on_failure` in `workflow.yaml` — by default the `work` stage — so the agent can resolve the conflict.

## `.orkestra/` Directory Layout

- **`workflow.yaml`** — Stage pipeline configuration
- **`agents/`** — Agent prompt templates; customize these per project to guide agent behavior
- **`scripts/`** — Shell scripts: `worktree_setup.sh` and `worktree_cleanup.sh` run when worktrees are created/removed; `checks.sh` is the default gate script
- **`.database/`** — SQLite database (gitignored)
- **`.logs/`** — Agent output logs (gitignored)
- **`.worktrees/`** — Per-Trak git worktrees (gitignored)
- **`.artifacts/`** — Stage artifacts (gitignored)

## Essential CLI Commands

```bash
ork trak list                          # List all Traks
ork trak show <trak-id>                # Show Trak details and current stage
ork trak create -t "Title" -d "Desc"  # Create a new Trak
ork trak approve <trak-id>             # Approve the current stage output
ork trak reject <trak-id> -r "reason" # Reject and request changes
```

## More Information

See the [Orkestra project](https://github.com/tiniest-fox/orkestra) for full documentation, configuration reference, and guides.
