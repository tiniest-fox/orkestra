# orkestra-agent

Agent execution infrastructure for Orkestra. Owns spawning, output streaming, result parsing, and provider resolution.

## Quick Start

```rust
use std::sync::Arc;
use orkestra_agent::{
    AgentRunner, ProcessAgentRunner, ProviderRegistry, RunConfig,
    claudecode_aliases, claudecode_capabilities,
};
use orkestra_agent::interactions::spawner::claude::ClaudeProcessSpawner;

// Set up the provider registry
let mut registry = ProviderRegistry::new("claudecode");
registry.register(
    "claudecode",
    Arc::new(ClaudeProcessSpawner::new()),
    claudecode_capabilities(),
    claudecode_aliases(),
);

// Create the runner
let runner = ProcessAgentRunner::new(Arc::new(registry));

// Run an agent
let config = RunConfig::new("/path/to/worktree", "Your prompt", r#"{"type":"object"}"#)
    .with_model("sonnet");
let result = runner.run_sync(config)?;
```

## Key Types

| Type | Purpose |
|------|---------|
| `AgentRunner` | Trait for running agents (sync or async) |
| `ProcessAgentRunner` | Production implementation using real CLI processes |
| `ProviderRegistry` | Resolves model specs to `ProcessSpawner` implementations |
| `ProviderCapabilities` | Describes what a provider supports (JSON schema, sessions, etc.) |
| `RunConfig` | Configuration for an agent run (prompt, schema, session, model) |
| `RunResult` | Result containing raw output and parsed `StageOutput` |
| `RunEvent` | Events during async execution: `LogLine`, `SessionId`, `Completed` |

## Provider System

The registry maps provider names to their `ProcessSpawner` implementations:

```rust
// Resolve model specs to providers
registry.resolve(None)?;                      // Default provider (claudecode)
registry.resolve(Some("sonnet"))?;            // Alias lookup across all providers
registry.resolve(Some("claudecode/opus"))?;   // Explicit provider + alias
registry.resolve(Some("opencode/kimi-k2"))?;  // OpenCode provider
```

**Supported providers:**

| Provider | CLI | JSON Schema | Sessions | System Prompt |
|----------|-----|-------------|----------|---------------|
| `claudecode` | `claude` | Native (`--json-schema`) | `--session-id` / `--resume` | `--append-system-prompt` |
| `opencode` | `opencode run` | Embedded in prompt | `--session` (continue only) | Not supported |

**Model aliases:**

- Claude Code: `sonnet`, `opus`, `haiku`
- OpenCode: `kimi-k2`, `kimi-k2.5`

## Script Execution

For script-based stages (not agent stages), use `ScriptHandle`:

```rust
use orkestra_agent::{ScriptHandle, ScriptEnv, ScriptPollState};
use std::time::Duration;

let env = ScriptEnv::new()
    .with("ORKESTRA_TASK_ID", "task-123")
    .with("ORKESTRA_BRANCH", "feature/foo");

let mut handle = ScriptHandle::spawn_with_env(
    "cargo test",
    Path::new("/worktree"),
    Duration::from_secs(300),
    &env,
)?;

// Poll for completion
loop {
    match handle.try_wait()? {
        ScriptPollState::Running { new_output } => {
            if let Some(output) = new_output {
                println!("{}", output);
            }
        }
        ScriptPollState::Completed(result) => {
            if result.is_success() {
                println!("Script passed");
            }
            break;
        }
    }
}
```

## Testing

Enable the `testutil` feature for `MockAgentRunner`:

```toml
[dev-dependencies]
orkestra-agent = { path = "../orkestra-agent", features = ["testutil"] }
```

```rust
use orkestra_agent::{MockAgentRunner, default_test_registry};
use orkestra_parser::StageOutput;

let runner = MockAgentRunner::new();
runner.set_output("task-1", StageOutput::Artifact {
    content: "Implementation complete".into(),
    activity_log: None,
});

// Runner will return the configured output when task-1 runs
```

## Dependencies

- `orkestra-process` - Process lifecycle management (`ProcessSpawner`, `ProcessHandle`)
- `orkestra-parser` - Output parsing (`AgentParser`, `StageOutput`)
- `orkestra-types` - Domain types (`LogEntry`)
- `orkestra-debug` - Debug logging infrastructure
