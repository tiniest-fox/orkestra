# orkestra-parser

Agent output parsing for Orkestra. Parses and validates structured output from Claude Code and OpenCode agents into typed `StageOutput` values.

## Usage

```rust
use orkestra_parser::{ClaudeParserService, OpenCodeParserService, AgentParser};
use orkestra_parser::interactions::output::{parse_stage_output};

// Create a provider-specific parser
let parser = ClaudeParserService::new();
// or: let parser = OpenCodeParserService::new();

// Two-phase parsing: extract then validate
let json_str = parser.extract_output(&full_output)?;
let output = parse_stage_output::execute(&json_str, &schema)?;

match output {
    StageOutput::Artifact { content, .. } => println!("Got artifact: {}", content),
    StageOutput::Questions { questions } => println!("Got {} questions", questions.len()),
    StageOutput::Approval { decision, .. } => println!("Decision: {}", decision),
    StageOutput::Subtasks { subtasks, .. } => println!("Got {} subtasks", subtasks.len()),
    StageOutput::Failed { error } => println!("Failed: {}", error),
    StageOutput::Blocked { reason } => println!("Blocked: {}", reason),
}
```

## Key Pattern

Output classification is a two-phase process:

1. `parser.extract_output()` — provider-specific JSON extraction from raw stdout
2. `parse_stage_output::execute()` — centralized type interpretation with schema validation

The schema (same one sent to agents via `--json-schema`) serves as the single source of truth for what output is valid. Callers that need the full three-way classification (success / extraction-failed / parse-failed) should use `orkestra_agent::interactions::agent::classify_output::execute()`.

## Trait

The `AgentParser` trait defines the provider contract:

| Method | Purpose |
|--------|---------|
| `parse_line(&mut self, line)` | Parse one stdout line during streaming (returns `ParsedUpdate`) |
| `finalize(&mut self)` | Flush buffered entries when stream ends |
| `extract_output(&self, full_output)` | Extract structured JSON from complete output |

## Implementations

| Parser | Format | Session ID | Extraction |
|--------|--------|------------|------------|
| `ClaudeParserService` | JSONL with `structured_output` wrapper | Supplied upfront via `--session-id` | Scans for last `structured_output` entry |
| `OpenCodeParserService` | JSON events with fenced JSON fallback | Extracted from `sessionID` field | JSONL scan → `last_text` → fenced JSON |

## Key Types

| Type | Description |
|------|-------------|
| `StageOutput` | Parsed agent output (Artifact, Questions, Approval, Subtasks, Failed, Blocked) |
| `ParsedUpdate` | Result from streaming: log entries + optional session ID |
| `ResumeMarker` | Parsed `<!orkestra:spawn:*>` or `<!orkestra:resume:*>` markers |
| `StageOutputError` | Parsing errors (JSON parse, schema validation, missing field) |

## Notes

- Pure logic, no I/O — schema must be passed in
- Schema validation uses `jsonschema` crate
- Both parsers share output interactions (`parse_stage_output`, `extract_from_jsonl`)
- Claude uses JSONL with result type markers; OpenCode uses fenced JSON blocks
