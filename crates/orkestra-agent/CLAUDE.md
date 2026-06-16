# CLAUDE.md — orkestra-agent

Agent execution crate. Owns spawning, output streaming, result parsing, script execution, and provider resolution.

## Module Structure

```
src/
├── lib.rs              # Public API re-exports
├── interface.rs        # AgentRunner trait (run_sync, run_async)
├── service.rs          # ProcessAgentRunner implementation
├── registry.rs         # ProviderRegistry, ExecutionMode, capabilities, aliases
├── types.rs            # RunConfig, RunEvent, RunResult, RunError
├── script_handle.rs    # ScriptHandle for gate script execution
├── mock.rs             # MockAgentRunner (feature-gated)
└── interactions/
    ├── agent/
    │   ├── build_process_config.rs  # Convert RunConfig → ProcessConfig
    │   ├── classify_output.rs       # Two-phase output classification (ExtractionFailed / ParseFailed / Success)
    │   ├── run_sync.rs              # Blocking execution
    │   ├── run_async.rs             # Async execution with event streaming (Process path)
    │   └── run_pty.rs               # PTY-based interactive execution (PTY path)
    ├── hooks/
    │   ├── server.rs    # HookServer — Unix domain socket listener for claude hook events
    │   └── types.rs     # HookEvent, HookEventType, HookReceiver
    ├── env/
    │   └── resolve_project_env.rs   # Resolve project env vars from config
    └── spawner/
        ├── cli_path.rs    # PATH preparation for CLI tools
        ├── claude.rs      # ClaudeProcessSpawner
        ├── codex.rs       # CodexProcessSpawner
        └── opencode.rs    # OpenCodeProcessSpawner
```

## Key Patterns

### Provider Registry

Model specs are resolved via prefix-based routing in `resolve_spec()`:

| Format | Example | Resolution |
|--------|---------|------------|
| `None` | - | Default provider's default model |
| `claude/X` | `"claude/sonnet-4.6"` | Claude Code — prefix stripped, `X` passed raw |
| `claudecode/X` | `"claudecode/opus"` | Claude Code — prefix stripped, `X` passed raw |
| `codex/X` | `"codex/o4-mini"` | Codex — prefix stripped, `X` passed as `--model` |
| Other prefixed | `"opencode/kimi-k2.6"`, `"moonshot/..."` | OpenCode — full spec passed as `--model` |
| Bare alias | `"sonnet"`, `"kimi"` | Alias table lookup; error on miss |

No alias resolution happens on the model part of prefixed specs — Claude Code handles its own model shortcuts. Unknown prefixes route to OpenCode automatically, so new OpenCode models need no registry entry.

The registry also creates provider-specific parsers via `create_parser()`.

### Provider Capabilities

`ProviderCapabilities` describes what each provider supports:

```rust
pub struct ProviderCapabilities {
    pub execution_mode: ExecutionMode,        // Process (stdin/stdout) or Pty (virtual terminal)
    pub supports_json_schema: bool,           // Native --json-schema flag
    pub supports_sessions: bool,              // Session resume support
    pub generates_own_session_id: bool,       // Provider creates session IDs
    pub requires_direct_structured_output: bool,  // StructuredOutput tool format
    pub supports_system_prompt: bool,         // --system flag support
}
```

`ExecutionMode::Pty` providers bypass `ProcessSpawner` entirely — `run_pty` owns its own `PtyHandle` and the spawner field in the registry is a `StubPtySpawner` used only for capability/parser dispatch.

When `supports_json_schema` is false, the JSON schema is embedded in the prompt text upstream (in `orkestra-prompt`).

### PTY Execution Path

The PTY path (`run_pty.rs`) is an alternative to the standard process path (`run_async.rs`) for billing-friendly interactive sessions. Key design constraints:

- **`ProcessSpawner` is bypassed entirely** — `run_pty` owns a `PtyHandle` directly. The spawner stored in the registry for `claude-pty` is a `StubPtySpawner` used only for capability and parser dispatch.
- **No stdout streaming** — PTY output isn't available as a stream; `run_pty` watches the claude JSONL transcript file. This means `has_activity` / `has_confirmed_output` must be signaled by emitting synthetic `LogLine` events after the transcript file appears (one `Text` entry is insufficient — at least 2 are needed to cross `has_confirmed_output`'s threshold).
- **Disallowed tools divergence risk** — `run_pty.rs` assembles the `--disallowedTools` flag independently of `spawner/claude.rs`. If you add a new default-disallowed tool to the headless spawner, you must mirror it in `run_pty.rs::build_pty_command()`. There is no shared constant for this list yet.
- **Environment isolation differs** — The PTY path inherits the parent process environment (portable-pty default) then overlays `cfg.env`. The headless spawner calls `env_clear()` first. PTY sessions may see env vars that headless sessions don't.

### Output Classification

`classify_output::execute()` is the single source of truth for agent output classification. Both `run_async` and `run_sync` delegate to it. It returns a four-way `OutputClassification` enum:

| Variant | Trigger | Downstream action |
|---------|---------|-------------------|
| `Success(StageOutput)` | Extraction found structured output + parse succeeded | Normal stage processing |
| `ExtractionFailed(String)` | `ExtractionResult::Error` (API error, crash, etc.) | `AgentCompletionError::Crash` — no retry |
| `PlainText(String)` | `ExtractionResult::NotFound` — agent produced no structured output | `ExecutionResult::AgentPlainText` → `park_plain_text` in orkestra-core |
| `ParseFailed(String)` | Extraction succeeded but schema validation failed | `AgentCompletionError::MalformedOutput` — retry with corrective prompt |

The key invariant: only `ParseFailed` maps to `MalformedOutput`. Plain text (agent wrote prose but no JSON/fenced block) and extraction errors never trigger the malformed-output retry loop.

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

| Feature | Claude Code | OpenCode | Codex |
|---------|-------------|----------|-------|
| CLI command | `claude` | `opencode run` | `codex exec --json` |
| JSON schema | `--json-schema` flag | Embedded in prompt | `--output-schema` temp file |
| New session | `--session-id UUID` | Auto-generated | Extracted from `thread.started` JSONL |
| Resume session | `--resume UUID` | `--session SES_ID` | `codex exec resume <id> -` |
| System prompt | `--append-system-prompt` | Not supported | Not supported |
| Disallowed tools | `--disallowedTools` flag | Prompt-level only | Prompt-level only |
| Output format | `--output-format stream-json` | `--format json` | JSONL (provider default) |

## Gotchas

- **Alias count assertions are mirrored**: `registry.rs` has `opencode_aliases_are_correct`, `claudecode_aliases_are_correct`, and `codex_aliases_are_correct` tests that assert both individual alias mappings *and* `aliases.len()`. When you add a model in `orkestra-types/src/config/models.rs`, the gate will fail until you also add the corresponding alias assertion and bump the `len()` in that test.

- **OpenCode session IDs**: OpenCode generates `ses_...` IDs internally. Don't pre-generate UUIDs for OpenCode — the session ID is extracted from the output stream.
- **Provider capabilities affect prompts**: When `supports_json_schema` is false, the JSON schema is injected into the prompt text by `PromptBuilder` in orkestra-prompt.
- **System prompt fallback**: When `supports_system_prompt` is false, the system prompt is inserted into the user message *after the first line* (the `<!orkestra:spawn:STAGE>` marker) so `parse_resume_marker` still detects the marker at position 0. On resume, the injection is skipped entirely — the session already has the system prompt from the initial spawn.
- **Disallowed tools fallback**: OpenCode doesn't support `--disallowedTools`, so restriction messages are injected into the system prompt only.
- **Disallowed tools are duplicated across paths**: The headless path (`spawner/claude.rs`) and the PTY path (`run_pty.rs::build_pty_command()`) each assemble `--disallowedTools` independently. When adding a new default-disallowed tool, update both.
- **`build_settings_file` ↔ mock script coupling**: `tests/fixtures/mock_claude_pty.sh` parses the hook settings JSON by navigating `hooks.Stop[0].hooks[0].command` (the nested Claude Code v2.1.170+ schema). When you change the shape emitted by `build_settings_file()`, update the mock to match — a shape mismatch causes PTY integration tests to hang silently rather than fail fast.
- **Dual-signal readiness: transcript growth fallback MUST be gated with `!is_resume`**: The fallback that treats transcript byte growth as "ready" exists for cases where `UserPromptSubmit` never fires. On resume, bookkeeping bytes (TUI re-init, transcript replay) grow the file before any real turn — this is precisely the race condition the PTY hook design was built to prevent. If you modify `wait_for_readiness`, keep `!is_resume` on the growth-fallback branch. Removing it silently re-introduces the original hang-on-resume bug; the mock test will still pass because the mock always reads stdin, but real Claude Code will not.
- **`send_hook.sh` exception swallowing**: The Python helper in `tests/fixtures/send_hook.sh` has `except Exception: pass`. A hook delivery failure produces no output, making test hangs appear as silent timeouts. If PTY hook tests hang unexpectedly, add `print(f"send_hook failed: {e}", file=sys.stderr)` to the except block to expose the root cause.
- **Three ANSI-stripping implementations**: `run_pty.rs` (hand-rolled, see cross-reference comment), `orkestra-networking::ci_log_parser` (hand-rolled), `orkestra-core` (via `strip_ansi_escapes` crate). When adding ANSI handling to a new crate, consider extracting a shared utility rather than adding a fourth copy.
- **Marker parser asymmetry**: `parse_resume_marker` only recognizes `continue`, `integration`, `answers`, and `initial`. Build_prompt emits `malformed_output` and `pr_comments` markers that the parser doesn't recognize, so `run_async.rs`'s else branch will log them as `resume_type: "user_message"` — mislabeled but logging-only. If the mislabeling becomes a problem, guard the else branch with `!prompt.trim_start().starts_with("<!orkestra:")` or extend `parse_resume_marker` with the missing variants.
- **File-tail byte offsets must track raw bytes, not string lengths**: `read_new_lines` uses `read_to_end` (not `read_to_string`) and finds the last `\n` on the raw byte slice *before* calling `from_utf8_lossy`. The returned position is always a raw byte offset. If you compute `new_pos` from the lossy `String` length instead, the offset drifts on any invalid UTF-8 sequence (which PTY output can contain mid-write), causing the tail loop to permanently skip or re-emit lines.
- **Path divergence in final transcript read**: After `tail_transcript_until_stop` exits, the caller uses `tail_file_pos` only when the hook-provided path matches `fallback_transcript_path`. When they differ (claude chose a session-specific path), the final read restarts at position 0 on the hook path and `full_output.clear()` is called first. Omitting the clear concatenates content from both files into a single malformed output.

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

When writing unit tests for `classify_output` or `run_async`, use the shared `MockParser` in `interactions/agent/mod.rs`:

```rust
use super::super::test_support::MockParser;

let parser = MockParser { extract_result: ExtractionResult::NotFound };
```

The `test_support` module is `#[cfg(test)] pub(crate)` — only visible in test builds within the crate.

**Dead-code lint vs test references**: Rust's lib dead_code lint fires even for functions that are only called from `#[cfg(test)]` blocks. Marking the function itself `#[cfg(test)]` is required to silence the warning — test references alone don't suppress it.

The PTY integration tests in `tests/pty_integration.rs` use `mock_claude_pty.sh` and are `#[ignore]`d by default (no real `claude` binary required in CI). Run them locally to verify the settings schema and hook protocol:

```bash
cargo test -p orkestra-agent --test pty_integration -- --ignored
```
