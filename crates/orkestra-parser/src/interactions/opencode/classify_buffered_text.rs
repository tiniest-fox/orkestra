//! Classify buffered text as structured output, mixed prose+JSON, or plain text.

use orkestra_types::domain::LogEntry;

use crate::interactions::output::{extract_fenced_json, extract_ork_fence, strip_markdown_fences};

/// Classify buffered text and produce appropriate log entries.
///
/// Checks (in order):
/// 1. Is the text valid JSON with a `type` field? → empty vec (structured output is extracted
///    separately via `extract_output()`; no log entry is emitted)
/// 2. Does the text contain prose + a fenced JSON block? → `Text` only (for the prose portion)
/// 3. Otherwise → plain `Text`
pub fn execute(text: &str) -> Vec<LogEntry> {
    // Check if the buffered text is the structured JSON output.
    // Don't emit a log entry — ArtifactProduced entries render the output; StructuredOutput
    // log entries are redundant.
    let stripped = strip_markdown_fences::execute(text);
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stripped) {
        if json.get("type").and_then(|t| t.as_str()).is_some() {
            return vec![];
        }
    }

    // Suppress text containing an ork fence — multi-fence output where
    // strip_markdown_fences and extract_fenced_json both fail would otherwise
    // leak the raw ork block into the UI as a Text entry.
    if extract_ork_fence::execute(text).is_some() {
        return vec![];
    }

    // Check if the text contains prose + a fenced JSON block (mixed content).
    // Emit only the prose as a Text entry; drop the structured JSON.
    if let Some((prose, json_str)) = extract_fenced_json::execute(text) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if json.get("type").and_then(|t| t.as_str()).is_some() {
                let mut entries = Vec::new();
                if !prose.is_empty() {
                    entries.push(LogEntry::Text { content: prose });
                }
                return entries;
            }
        }
    }

    // Not structured JSON — flush as normal text
    vec![LogEntry::Text {
        content: text.to_string(),
    }]
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ork_fence_alone_returns_empty() {
        let text = "```ork\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        assert!(execute(text).is_empty());
    }

    #[test]
    fn ork_and_json_multi_fence_returns_empty() {
        let text =
            "```ork\n{\"type\":\"summary\",\"content\":\"a\"}\n```\n```json\n{\"extra\":1}\n```";
        assert!(execute(text).is_empty());
    }

    #[test]
    fn prose_before_ork_fence_returns_empty() {
        let text = "Here is my output:\n\n```ork\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        assert!(execute(text).is_empty());
    }

    #[test]
    fn plain_text_returns_text_entry() {
        let text = "This is just some prose.";
        let entries = execute(text);
        assert_eq!(entries.len(), 1);
        assert!(matches!(&entries[0], LogEntry::Text { content } if content == text));
    }

    #[test]
    fn json_fenced_structured_output_returns_empty() {
        let text = "```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        assert!(execute(text).is_empty());
    }

    #[test]
    fn mixed_prose_and_json_fence_returns_prose_only() {
        let text = "Some prose here.\n\n```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let entries = execute(text);
        assert_eq!(entries.len(), 1);
        assert!(
            matches!(&entries[0], LogEntry::Text { content } if content.contains("Some prose"))
        );
    }
}
