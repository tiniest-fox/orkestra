# Orkestra

Orkestra orchestrates AI coding agents to plan and implement software tasks with human oversight. Each Trak gets an isolated git worktree; agents move through configurable stages with approval checkpoints.

## Key Concepts

- **Trak** — A unit of work (internally "task"). Each Trak has a title, description, and progresses through stages.
- **Stage** — A step in the workflow (e.g., planning, work, review). Each stage runs an agent or waits for human input.
- **Flow** — A named sequence of stages defined in `workflow.yaml`.
- **Worktree** — An isolated git worktree created for each Trak so parallel work never conflicts.
- **Agent** — An AI coding assistant (e.g., Claude Code) that executes a stage and produces output for review.

## `.orkestra/` Directory Layout

- **`workflow.yaml`** — Stage pipeline configuration
- **`agents/`** — Agent prompt templates; customize these per project to guide agent behavior
- **`scripts/`** — Shell scripts run at key points: `worktree_setup.sh` and `worktree_cleanup.sh` run when worktrees are created/removed; other scripts (e.g., checks) run during the workflow
- **`.database/`** — SQLite database (gitignored)
- **`.logs/`** — Agent output logs (gitignored)
- **`.worktrees/`** — Per-Trak git worktrees (gitignored)

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
