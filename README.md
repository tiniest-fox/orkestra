# Orkestra

AI-powered Trak orchestration for software development. Orkestra spawns AI coding agents to plan, implement, and review code changes with human oversight.

## Features

- Configurable multi-stage workflow pipeline (plan → breakdown → implement → review)
- Multiple AI provider support (Claude Code, OpenCode)
- Git worktree isolation — each Trak gets its own branch and worktree
- Subtask decomposition with dependency tracking
- Human-in-the-loop approvals and feedback at every stage
- Desktop app (Tauri) + CLI interface
- Run tab: launch and monitor your dev server with live log streaming and port chips

## Prerequisites

- Rust (latest stable)
- Node.js 18+ and pnpm
- At least one AI coding agent CLI: [Claude Code](https://claude.ai/code) or [OpenCode](https://opencode.ai)
- Git

## Quick Start

```bash
# Clone and install dependencies
git clone https://github.com/tiniest-fox/orkestra.git
cd orkestra
pnpm install

# Run the desktop app (includes frontend dev server)
pnpm tauri dev

# Or use the CLI
cargo build
bin/ork trak create -t "My first Trak" -d "Description here"
```

## Run Tab

The Orkestra desktop app's Run tab executes `.orkestra/scripts/run.sh` and streams its output as a live log. Use it to start your project's development server and monitor output alongside your Traks.

Declare named ports from your run script using `ORKESTRA_PORT` — they appear as clickable chips in the Run tab's control bar:

```bash
#!/bin/bash
# .orkestra/scripts/run.sh

bundle exec rails server -p 3000 &
pnpm dev --port 4000 &

echo "ORKESTRA_PORT Rails=3000"
echo "ORKESTRA_PORT Frontend=4000"

wait
```

Each chip shows `Label : port` and opens `http://localhost:<port>` in your browser when clicked. Ports persist in the bar for the lifetime of the run, even as log output scrolls past.

The `ORKESTRA_PORT` sentinel can appear anywhere in stdout or stderr: before, during, or after the server starts. Multiple servers, multiple ports — declare as many as you need.

## Architecture Overview

Orkestra is a Rust workspace with a React/TypeScript frontend:

- **`crates/orkestra-core/`** — Core orchestration library: workflow engine, task lifecycle, SQLite storage
- **`crates/orkestra-git/`** — Git operations: worktrees, branches, merging, diffs
- **`crates/orkestra-agent/`** — Agent spawning: provider registry, process management, session recovery
- **`crates/orkestra-prompt/`** — Prompt building: template rendering, context injection
- **`crates/orkestra-schema/`** — JSON schema generation for agent outputs
- **`cli/`** — `ork` CLI binary
- **`src-tauri/`** — Tauri desktop app backend
- **`src/`** — React/TypeScript frontend (Kanban board)

For detailed architecture, see [`CLAUDE.md`](CLAUDE.md). For cross-cutting flow documentation, see [`docs/flows/`](docs/flows/). For CLI usage, see [`docs/cli-guide.md`](docs/cli-guide.md).

## Development

**Rust:**

```bash
cargo test --workspace    # Run all tests
cargo clippy --workspace  # Lint check
cargo fmt --all           # Format code
```

**Frontend:**

```bash
pnpm check --error-on-warnings   # Biome lint + format
pnpm exec tsc --noEmit           # TypeScript type check
pnpm test:run                    # Unit tests
pnpm knip                        # Dead code / unused exports
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full development workflow.

## License

Orkestra is dual-licensed:

- **Core** (`crates/orkestra-*` except `orkestra-service`, `cli/`, `daemon/`, `src-tauri/`, `src/`) — [MIT](LICENSE)
- **Hosted platform** (`crates/orkestra-service/`, `service/`) — [FSL-1.1-ALv2](crates/orkestra-service/LICENSE)

FSL permits self-hosting and modification for any purpose except offering a competing hosted service. It converts to Apache 2.0 two years after each release. See [fsl.software](https://fsl.software) for details.
