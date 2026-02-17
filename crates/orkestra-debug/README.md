# orkestra-debug

Debug logging infrastructure for Orkestra with two separate channels for different purposes.

## Channels

| Channel | File | Enabled | stderr | Hook |
|---------|------|---------|--------|------|
| **debug** | `.orkestra/.logs/debug.log` | `ORKESTRA_DEBUG=1` | Yes | Yes |
| **agents** | `.orkestra/.logs/agents.log` | Always | No | No |

- **debug**: General debug logging for development. Gated by environment variable.
- **agents**: Structured agent output (LogEntry JSON). Always enabled for debugging agent behavior.

## Usage

```rust
use orkestra_debug::orkestra_debug;

// Debug channel (requires ORKESTRA_DEBUG=1)
orkestra_debug!("session", "Created session {} for task {}", session_id, task_id);

// Agents channel (always active)
orkestra_debug!("task/stage", target: agents, "{}", json);
```

## Enabling Debug Logging

```bash
# Enable debug file logging
ORKESTRA_DEBUG=1 pnpm tauri dev

# View logs in real-time
tail -f .orkestra/.logs/debug.log
tail -f .orkestra/.logs/agents.log
```

## Initialization

Both channels must be initialized at application startup:

```rust
use orkestra_debug::{init, init_agent_log, set_hook};
use std::path::Path;

let orkestra_dir = Path::new(".orkestra");

// Initialize debug channel (respects ORKESTRA_DEBUG env var)
init(orkestra_dir);

// Initialize agents channel (always enabled)
init_agent_log(orkestra_dir);

// Optional: register a hook for real-time events (e.g., Tauri)
set_hook(|component, message| {
    // Forward to Tauri event system, etc.
});
```

## Log Rotation

Logs auto-rotate when they exceed 5MB, keeping the last 2MB of content. Rotation happens transparently during writes.

## API

| Function | Purpose |
|----------|---------|
| `init(path)` | Initialize debug channel |
| `init_agent_log(path)` | Initialize agents channel |
| `set_hook(fn)` | Register debug event callback |
| `is_enabled()` | Check if debug file logging is on |
| `is_active()` | Check if any debug output is active (file or hook) |
| `is_agents_active()` | Check if agents channel is ready |
