# Contributing to Orkestra

## Development Setup

See [README.md](README.md) for prerequisites. Once installed:

```bash
pnpm install
cargo build
```

## Running Checks

All checks must pass before submitting a pull request.

**Rust:**

```bash
cargo fmt --all -- --check   # Formatting
cargo clippy --workspace     # Lints (zero warnings required)
cargo test --workspace       # All tests
```

**Frontend:**

```bash
pnpm check --error-on-warnings   # Biome lint + format
pnpm exec tsc --noEmit           # TypeScript type check
pnpm test:run                    # Unit tests (Vitest)
```

The automated gate script (`.orkestra/scripts/checks.sh`) runs the relevant subset based on what files changed. Run it locally to verify before pushing.

## Architecture

Before making changes, read [`CLAUDE.md`](CLAUDE.md). It covers architectural principles, module structure patterns, and file conventions that reviewers enforce.

Key sections:
- **Architectural Principles** — Clear Boundaries, Single Source of Truth, Fail Fast, etc. (in priority order)
- **Module Structure** — When to use interactions, traits, services, and mocks
- **File Structure Conventions** — File headers, sections, and subsection syntax

## Pull Requests

- Use a descriptive title that explains what changed and why
- Run the full test suite before submitting
- Keep changes focused — one concern per PR
- Reference any relevant context (task IDs, design decisions, trade-offs)
