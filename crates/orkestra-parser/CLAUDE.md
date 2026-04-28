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
    │   ├── extract_from_text_content.rs # Shared text-based extraction cascade (ork fence → fenced JSON → raw JSON); returns TextExtractionResult (Found/Malformed)
    │   ├── extract_ork_fence.rs         # Pull content from ```ork fences; "last wins" semantics; shared ork_fence_positions() helper
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
classify_output::execute(parser, output, schema)   ← in orkestra-agent
    │
    ├── parser.extract_output(output)    ← Provider-specific JSON extraction
    │   └── Claude: scan JSONL for structured_output → fallback: extract_from_text_content(last_text)
    │   └── OpenCode: scan JSONL → fallback: extract_from_text_content(last_text)
    │   Err → ExtractionFailed (agent produced no structured output; no retry)
    │
    └── parse_stage_output::execute()    ← Centralized schema validation + typing
        └── Same for both providers
        Err → ParseFailed (agent tried but format was invalid; corrective retry eligible)
```

The trait handles provider differences; `parse_stage_output` is the single source of truth for what output types exist. `parse_completion` was a removed convenience wrapper — callers now use `classify_output::execute()` in `orkestra-agent` to coordinate the two phases and get a typed `OutputClassification` result.

**Extraction pipeline principle:** Both parsers share `extract_from_text_content` as the single text-based extraction cascade. Never add a second extraction path — any new strategy belongs there. The cascade requires a `"type"` field on all strategies except ork fences (which are explicit opt-in markers validated downstream by `parse_stage_output`). Chat-mode detection (`try_complete_from_output`) also delegates to this same function and must pass only trailing buffer content — never all accumulated text — to prevent mid-response false positives.

## Provider Differences

| Concern | Claude Code | OpenCode |
|---------|-------------|----------|
| Output format | JSONL with `structured_output` wrapper | Fenced JSON in text events |
| Session ID | Caller supplies via `--session-id` | Extracted from `sessionID` field |
| Stream text | Text accumulated in `last_text`; passed to `extract_from_text_content` as fallback | Buffered, classified in `finalize()` |
| Tool result tracking | Maps `tool_use_id` → `tool_name` | Inline in tool_use event (v1.1+) |
| Subagent detection | Tracks Agent tool IDs | N/A |

## Gotchas

**Claude JSONL unwrapping**: The `structured_output` field may contain a nested JSON string that needs unwrapping. `extract_from_jsonl` handles this automatically.

**Claude ork fence extraction requires `last_text`, not raw JSONL**: Newlines inside JSON string values in JSONL are stored escaped (`\n` = `0x5C 0x6E`), not as real newlines (`0x0A`). `extract_ork_fence` searches for real newlines, so it would find nothing on raw JSONL. The fix: `ClaudeParserService` accumulates text content in `last_text` during streaming — `serde_json` unescapes string values when deserializing, so `last_text` contains real newlines. Ork fence extraction runs on `last_text`, not on the raw JSONL bytes.

**OpenCode text buffering**: Text events are buffered until the next non-text event because the final structured output arrives as a plain text event. `finalize()` classifies the last buffered text: structured JSON (valid JSON with a `type` field) returns an empty vec — no log entry is emitted, since `ArtifactProduced` already renders the output — while plain text returns a `Text` entry.

**`malformed_output` has no `ResumeMarkerType` variant (pre-existing gap)**: `ResumeType::MalformedOutput` has a template with marker `<!orkestra:resume:STAGE:malformed_output>`, but `parse_resume_marker.rs` has no matching `ResumeMarkerType::MalformedOutput` variant — the marker falls through to `None`. This means the run log records `resume_type: "user_message"` instead of `"malformed_output"`. When adding new resume types that should be tracked, add a parser variant alongside the template (as `gate_failure` does correctly).

**API error detection**: Both parsers check for API errors in the output. Claude embeds them in JSONL; OpenCode may emit error events. Always surface these as descriptive errors rather than generic parse failures.

**Schema is the source of truth**: The JSON schema passed to agents is the same schema used for validation here. Don't add validation logic outside of `parse_stage_output`.

## Anti-Patterns

- Don't add I/O to this crate — schema and output come from callers
- Don't hardcode provider-specific logic outside provider files
- Don't duplicate type interpretation — all output typing goes through `parse_stage_output`
- Don't add new `StageOutput` variants without updating the schema generator in `orkestra-schema`
