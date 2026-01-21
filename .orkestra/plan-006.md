## Summary

Convert the verbose plain-text log format into structured JSON log entries. This enables flexible UI rendering and filtering while reducing storage overhead by only keeping tool calls and assistant messages (not raw output).

## Current State

- Logs are stored as a single string in `Task.logs: Option<String>`
- Format: `[TYPE] content` entries separated by `\n\n---\n\n`
- Current types: TEXT, TOOL_USE, TOOL_RESULT, SYSTEM, ERROR, STDERR, PROCESS_EXIT, FINAL_RESULT
- Rendered as plain text in a `<pre>` tag

## Proposed Structured Format

Each log entry will be a JSON object with a `type` field and type-specific data:

```typescript
type LogEntry =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; tool: string; id: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; status: 'ok' | 'error'; output?: string }
  | { type: 'system'; subtype: string; message?: string }
  | { type: 'error'; message: string }
  | { type: 'process_exit'; code: number | null };
```

Logs field changes from `Option<String>` to `Option<Vec<LogEntry>>` (serialized as JSON array).

## Files to Modify

1. **`crates/orkestra-core/src/tasks.rs`** - Add LogEntry enum, change logs field type
2. **`crates/orkestra-core/src/agents.rs`** - Rewrite `format_stream_event()` to return LogEntry instead of String
3. **`src/types/task.ts`** - Add TypeScript LogEntry type, update Task interface
4. **`src/components/TaskDetailSidebar.tsx`** - Render structured logs with proper formatting

## Implementation Steps

### Step 1: Define LogEntry types in Rust (`tasks.rs`)

Add the LogEntry enum:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LogEntry {
    Text { content: String },
    ToolUse { tool: String, id: String, input: serde_json::Value },
    ToolResult { id: String, status: String, output: Option<String> },
    System { subtype: String, message: Option<String> },
    Error { message: String },
    ProcessExit { code: Option<i32> },
}
```

Change the Task struct:
```rust
pub logs: Option<Vec<LogEntry>>,
```

### Step 2: Update log functions (`tasks.rs`)

- Rename `update_task_logs()` to `append_task_log()` that appends a single LogEntry
- Add `clear_task_logs()` helper for when logs are reset

### Step 3: Rewrite `format_stream_event()` (`agents.rs`)

Change signature from `fn format_stream_event(json_line: &str) -> Option<String>` to `fn parse_stream_event(json_line: &str) -> Option<LogEntry>`

Update the match arms to return LogEntry variants:
- "assistant" with "text" -> `LogEntry::Text { content }`
- "assistant" with "tool_use" -> `LogEntry::ToolUse { tool, id, input }` (keep full input, let UI decide truncation)
- "result" with "tool_result" -> `LogEntry::ToolResult { id, status, output }`
- "system" -> `LogEntry::System { subtype, message }`
- "error" -> `LogEntry::Error { message }`

### Step 4: Update agent log accumulation (`agents.rs`)

In `spawn_agent()`, change from:
```rust
let mut log_entries: Vec<String> = Vec::new();
// ...
log_entries.push(formatted.clone());
let log_content = log_entries.join("\n\n---\n\n");
update_task_logs(&task_id, &log_content);
```

To:
```rust
// Call append_task_log() for each entry instead of accumulating
if let Some(entry) = parse_stream_event(&json_line) {
    append_task_log(&task_id, entry);
}
```

### Step 5: Add TypeScript types (`src/types/task.ts`)

```typescript
export type LogEntry =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; tool: string; id: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; status: 'ok' | 'error'; output?: string }
  | { type: 'system'; subtype: string; message?: string }
  | { type: 'error'; message: string }
  | { type: 'process_exit'; code: number | null };

export interface Task {
  // ...existing fields
  logs?: LogEntry[];
}
```

### Step 6: Update UI rendering (`TaskDetailSidebar.tsx`)

Create a `LogEntryRenderer` component that handles each type:
- `text`: Show as assistant message (light gray background)
- `tool_use`: Show tool name as a badge with collapsible input details
- `tool_result`: Show status indicator (green checkmark/red X) with collapsible output
- `system`: Dim gray text, minimal display
- `error`: Red background with error icon
- `process_exit`: Show exit code with success/failure coloring

Example rendering for tool calls:
```
[Read] file: src/main.rs               ✓
[Bash] command: cargo build            ✓
[Edit] file: src/lib.rs                ✓
```

## Testing Strategy

1. **Unit tests for LogEntry serialization** - Verify the Rust LogEntry enum serializes to the expected JSON format
2. **Manual testing** - Start a task and verify:
   - Logs appear in real-time with proper formatting
   - Tool calls show the correct tool name and relevant input summary
   - Tool results show success/failure status
   - Text messages are readable
3. **Migration test** - Verify existing tasks with old string logs don't crash (handle gracefully by showing raw text or clearing)

## Risks/Considerations

1. **Migration of existing logs**: Existing tasks have string logs. Options:
   - Clear old logs on first run (simplest)
   - Or make logs field support both formats during transition (more complex)
   - Recommendation: Clear old logs - they're ephemeral debugging info anyway

2. **Storage size**: Storing full tool inputs could be large. Mitigations:
   - Truncate long outputs in ToolResult (keep max 1000 chars)
   - Don't store tool_result output at all (just status) - can always re-read from Claude logs if needed
   - Filter out system events entirely (just noise)

3. **UI performance**: Large log arrays could slow rendering. Mitigations:
   - Use virtualized list for rendering (only render visible items)
   - Or limit display to last N entries with "show more" button

4. **What to exclude**: Based on the task description, we should NOT store:
   - Full tool result outputs (just keep status)
   - System/init events (noise)
   - STDERR (debugging only)
   - Keep: tool_use, tool_result (status only), text, error, process_exit
