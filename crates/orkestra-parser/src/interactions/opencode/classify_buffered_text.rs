//! Classify buffered text as structured output, mixed prose+JSON, or plain text.

use orkestra_types::domain::{LogEntry, ToolInput};

use crate::interactions::output::{extract_fenced_json, strip_markdown_fences};

/// Classify buffered text and produce appropriate log entries.
///
/// Checks (in order):
/// 1. Is the text valid JSON with a `type` field? → `StructuredOutput` tool use
/// 2. Does the text contain prose + a fenced JSON block? → `Text` + `StructuredOutput`
/// 3. Otherwise → plain `Text`
pub fn execute(text: &str) -> Vec<LogEntry> {
    // Check if the buffered text is the structured JSON output.
    let stripped = strip_markdown_fences::execute(text);
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stripped) {
        if let Some(output_type) = json.get("type").and_then(|t| t.as_str()) {
            return vec![LogEntry::ToolUse {
                tool: "StructuredOutput".to_string(),
                id: "structured-output".to_string(),
                input: ToolInput::StructuredOutput {
                    output_type: output_type.to_string(),
                },
            }];
        }
    }

    // Check if the text contains prose + a fenced JSON block (mixed content).
    if let Some((prose, json_str)) = extract_fenced_json::execute(text) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if let Some(output_type) = json.get("type").and_then(|t| t.as_str()) {
                let mut entries = Vec::new();
                if !prose.is_empty() {
                    entries.push(LogEntry::Text { content: prose });
                }
                entries.push(LogEntry::ToolUse {
                    tool: "StructuredOutput".to_string(),
                    id: "structured-output".to_string(),
                    input: ToolInput::StructuredOutput {
                        output_type: output_type.to_string(),
                    },
                });
                return entries;
            }
        }
    }

    // Not structured JSON — flush as normal text
    vec![LogEntry::Text {
        content: text.to_string(),
    }]
}
