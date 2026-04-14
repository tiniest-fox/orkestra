# orkestra-schema

JSON schema generation for agent stage outputs.

## Module Structure

```
src/
├── lib.rs              # Entry point, re-exports, PLANNER_OUTPUT_SCHEMA constant
├── generate_schema.rs  # Core generation logic (execute function)
├── types.rs            # SchemaConfig struct
├── examples.rs         # Schema-validated example generators
└── schemas/
    └── components/     # JSON schema fragments (embedded at compile time)
        ├── artifact.json
        ├── questions.json
        ├── subtasks.json
        ├── approval.json
        └── terminal.json
```

## Key Patterns

**Pure functions, no traits, no state.** This crate has no I/O and no side effects. Schema components are embedded at compile time via `include_str!`.

**Flat discriminated union.** Generated schemas use a `type` field discriminator rather than `oneOf`. This simplifies agent output parsing and validation.

**Single entry point.** Use `generate_stage_schema(&SchemaConfig)` for all schema generation. The function name is `execute` internally but re-exported as `generate_stage_schema`.

## PLANNER_OUTPUT_SCHEMA

`lib.rs` exports a `LazyLock<String>` constant for convenience:

```rust
pub static PLANNER_OUTPUT_SCHEMA: LazyLock<String> = LazyLock::new(|| {
    generate_stage_schema(&SchemaConfig {
        artifact_name: "plan",
        produces_subtasks: false,
        has_approval: false,
        route_to_stages: &[],
    })
});
```

**Prefer `generate_stage_schema` for new code.** The constant exists for backwards compatibility but hardcodes the planner configuration. Dynamic schema generation via `SchemaConfig` is the intended pattern.

## Schema Composition Logic

`generate_schema.rs` builds schemas by:

1. Loading component JSON files (embedded at compile time)
2. Building a `type` enum based on config flags
3. Merging properties from relevant components
4. Outputting a flat JSON schema string

Key behaviors:
- `produces_subtasks: true` — Artifact name excluded from type enum (subtasks wraps the artifact)
- `has_approval: true` — Artifact name excluded; approval type replaces it
- Terminal states (`failed`, `blocked`) always included

## Example Generators

`examples.rs` provides functions that generate JSON examples validated against the actual schema components. If schemas change and examples become invalid, tests fail — ensuring examples stay in sync.

Use these when building prompts that need concrete output examples.

## Anti-patterns

- **Don't add I/O.** This crate is pure logic. File reading, network calls, etc. belong elsewhere.
- **Don't hardcode schemas.** Use `generate_stage_schema` with appropriate `SchemaConfig`. New stage types should work with the existing generation logic.
- **Don't use `oneOf` or `anyOf` in any agent-facing schema** — generated or static. LLMs have poor reliability with these combinators. For discriminated unions, use the flat `type` field pattern. For "at least one of X/Y required" constraints, enforce in code at the parse boundary rather than in the schema.
