# CLAUDE.md — orkestra-agent

Agent execution crate. Owns spawning, output streaming, result parsing, script execution, and provider resolution.

## Module Structure

```
src/
├── lib.rs              # Public API re-exports
├── interface.rs        # AgentRunner trait (run_sync, run_async)
├── service.rs          # ProcessAgentRunner implementation
├── registry.rs         # ProviderRegistry, capabilities, aliases
├── types.rs            # RunConfig, RunEvent, RunResult, RunError
├── script_handle.rs    # ScriptHandle for gate script execution
├── mock.rs             # MockAgentRunner (feature-gated)
└── interactions/
    ├── agent/
    │   ├── build_process_config.rs  # Convert RunConfig → ProcessConfig
    │   ├── run_sync.rs              # Blocking execution
    │   └── run_async.rs             # Async execution with event streaming
    └── spawner/
        ├── cli_path.rs    # PATH preparation for CLI tools
        ├── claude.rs      # ClaudeProcessSpawner
        └── opencode.rs    # OpenCodeProcessSpawner
```

## Key Patterns

### Provider Registry

Model specs are resolved through the registry:

| Format | Example | Resolution |
|--------|---------|------------|
| `None` | - | Default provider's default model |
| Alias only | `"sonnet"` | Search all providers' alias tables |
| Explicit | `"claudecode/opus"` | Look up provider, resolve alias |
| Passthrough | `"claudecode/claude-opus-4-5-20251101"` | Look up provider, use raw ID |

The registry also creates provider-specific parsers via `create_parser()`.

### Provider Capabilities

`ProviderCapabilities` describes what each provider supports:

```rust
pub struct ProviderCapabilities {
    pub supports_json_schema: bool,           // Native --json-schema flag
    pub supports_sessions: bool,              // Session resume support
    pub generates_own_session_id: bool,       // Provider creates session IDs
    pub requires_direct_structured_output: bool,  // StructuredOutput tool format
    pub supports_system_prompt: bool,         // --system flag support
}
```

When `supports_json_schema` is false, the JSON schema is embedded in the prompt text upstream (in `orkestra-prompt`).

### RunEvent Streaming

Async execution emits events through a channel:

- `LogLine(LogEntry)` — Parsed log entry from stdout stream
- `SessionId(String)` — Extracted session ID (OpenCode generates its own)
- `Completed(Result<StageOutput, String>)` — Final result

### Script Execution

`ScriptHandle` runs shell commands for gate scripts:

- Spawns via `sh -c` in its own process group
- Streams stdout/stderr through channels
- Supports timeout with automatic kill
- `ScriptEnv` passes task context via environment variables

## Provider Differences

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| CLI command | `claude` | `opencode run` |
| JSON schema | `--json-schema` flag | Embedded in prompt |
| New session | `--session-id UUID` | Auto-generated |
| Resume session | `--resume UUID` | `--session SES_ID` |
| System prompt | `--append-system-prompt` | Not supported |
| Disallowed tools | `--disallowedTools` flag | Prompt-level only |
| Output format | `--output-format stream-json` | `--format json` |

## Gotchas

- **OpenCode session IDs**: OpenCode generates `ses_...` IDs internally. Don't pre-generate UUIDs for OpenCode — the session ID is extracted from the output stream.
- **Provider capabilities affect prompts**: When `supports_json_schema` is false, the JSON schema is injected into the prompt text by `PromptBuilder` in orkestra-prompt.
- **System prompt fallback**: When `supports_system_prompt` is false, the system prompt is prepended to the user message upstream.
- **Disallowed tools fallback**: OpenCode doesn't support `--disallowedTools`, so restriction messages are injected into the system prompt only.
- **Marker parser asymmetry**: `parse_resume_marker` only recognizes `continue`, `integration`, `answers`, and `initial`. Build_prompt emits `malformed_output` and `pr_comments` markers that the parser doesn't recognize, so `run_async.rs`'s else branch will log them as `resume_type: "user_message"` — mislabeled but logging-only. If the mislabeling becomes a problem, guard the else branch with `!prompt.trim_start().starts_with("<!orkestra:")` or extend `parse_resume_marker` with the missing variants.

## Anti-patterns

- Don't hardcode provider-specific behavior outside spawner files — use `ProviderCapabilities`
- Don't construct `ProcessConfig` directly — use `build_process_config::execute()`
- Don't bypass the registry for model resolution — it handles aliases and capabilities

## Testing

Use `MockAgentRunner` for tests that don't need real agent processes:

```rust
let runner = MockAgentRunner::new();
runner.set_output("task-id", StageOutput::Artifact { ... });

// For tests that need activity detection:
runner.set_output_with_activity("task-id", output);  // Emits LogLine before Completed
```

Use `default_test_registry()` when testing code that needs to check provider capabilities without spawning real processes.
