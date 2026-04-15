# orkestra-parser

Agent output parsing and validation. Pure logic, no I/O.

## Module Structure

```
src/
├── lib.rs               # parse_completion() entry point, re-exports
├── interface.rs         # AgentParser trait
├── types.rs             # StageOutput, ParsedUpdate, ResumeMarker, errors
├── claude.rs            # ClaudeParserService (JSONL format)
├── opencode.rs          # OpenCodeParserService (JSON events + fenced fallback)
└── interactions/
    ├── claude/          # Claude Code format parsing
    │   ├── parse_assistant_content.rs   # Extract log entries from assistant messages
    │   └── parse_tool_result_event.rs   # Extract Agent tool results
    ├── opencode/        # OpenCode format parsing
    │   ├── classify_buffered_text.rs    # Classify final text; suppress structured JSON, emit Text for prose
    │   ├── extract_text_content.rs      # Extract text from v1.1+ or legacy events
    │   ├── extract_tool_result_event.rs # Extract tool results
    │   └── extract_tool_use_event.rs    # Extract tool use from v1.1+ or legacy events
    ├── output/          # Shared output extraction
    │   ├── check_api_error.rs           # Detect API errors in JSONL
    │   ├── extract_fenced_json.rs       # Extract JSON from markdown fences
    │   ├── extract_from_jsonl.rs        # Scan JSONL for structured_output
    │   ├── parse_stage_output.rs        # Schema validation + type interpretation
    │   └── strip_markdown_fences.rs     # Remove ```json fences
    └── stream/          # Shared stream parsing
        ├── extract_tool_result_content.rs # Truncate tool result content
        ├── parse_resume_marker.rs         # Parse <!orkestra:*> markers
        └── parse_tool_input.rs            # Parse tool input into ToolInput enum
```

## Key Pattern

**Two-phase completion parsing:**

```
parse_completion(parser, output, schema)
    │
    ├── parser.extract_output(output)    ← Provider-specific JSON extraction
    │   └── Claude: scan JSONL for structured_output
    │   └── OpenCode: JSONL → last_text → fenced JSON
    │
    └── parse_stage_output::execute()    ← Centralized schema validation + typing
        └── Same for both providers
```

The trait handles provider differences; `parse_stage_output` is the single source of truth for what output types exist.

## Provider Differences

| Concern | Claude Code | OpenCode |
|---------|-------------|----------|
| Output format | JSONL with `structured_output` wrapper | Fenced JSON in text events |
| Session ID | Caller supplies via `--session-id` | Extracted from `sessionID` field |
| Stream text | Text accumulated in `last_text` for ork fence fallback | Buffered, classified in `finalize()` |
| Tool result tracking | Maps `tool_use_id` → `tool_name` | Inline in tool_use event (v1.1+) |
| Subagent detection | Tracks Agent tool IDs | N/A |

## Gotchas

**Claude JSONL unwrapping**: The `structured_output` field may contain a nested JSON string that needs unwrapping. `extract_from_jsonl` handles this automatically.

**Claude ork fence extraction requires `last_text`, not raw JSONL**: Newlines inside JSON string values in JSONL are stored escaped (`\n` = `0x5C 0x6E`), not as real newlines (`0x0A`). `extract_ork_fence` searches for real newlines, so it would find nothing on raw JSONL. The fix: `ClaudeParserService` accumulates text content in `last_text` during streaming — `serde_json` unescapes string values when deserializing, so `last_text` contains real newlines. Ork fence extraction runs on `last_text`, not on the raw JSONL bytes.

**OpenCode text buffering**: Text events are buffered until the next non-text event because the final structured output arrives as a plain text event. `finalize()` classifies the last buffered text: structured JSON (valid JSON with a `type` field) returns an empty vec — no log entry is emitted, since `ArtifactProduced` already renders the output — while plain text returns a `Text` entry.

**API error detection**: Both parsers check for API errors in the output. Claude embeds them in JSONL; OpenCode may emit error events. Always surface these as descriptive errors rather than generic parse failures.

**Schema is the source of truth**: The JSON schema passed to agents is the same schema used for validation here. Don't add validation logic outside of `parse_stage_output`.

## Anti-Patterns

- Don't add I/O to this crate — schema and output come from callers
- Don't hardcode provider-specific logic outside provider files
- Don't duplicate type interpretation — all output typing goes through `parse_stage_output`
- Don't add new `StageOutput` variants without updating the schema generator in `orkestra-schema`
