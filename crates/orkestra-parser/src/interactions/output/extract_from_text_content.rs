//! Extract structured output from model text content.
//!
//! Tries three strategies in priority order on accumulated model text:
//! ork fence, markdown fence stripping (also catches plain JSON), then fenced
//! JSON from mixed prose. All strategies require a `"type"` string field.
//! Called by parser implementations after JSONL extraction fails.

use super::{extract_fenced_json, extract_ork_fence, strip_markdown_fences};

/// Try to extract structured JSON from accumulated model text content.
///
/// Applies three strategies in priority order:
/// 1. Extract an ork fence block (explicit structured output marker — highest priority).
/// 2. Strip markdown fences and parse as JSON, requiring a `"type"` string field.
///    When no fences are present, `strip_markdown_fences` returns the trimmed input,
///    so this also catches plain JSON the model emitted without any wrapping.
/// 3. Extract a fenced JSON block from mixed prose+fence text, requiring a `"type"` field.
///
/// All strategies require a `"type"` string field so that arbitrary JSON objects (config
/// snippets, code examples) in the model output are not mistaken for stage output.
/// Schema validation happens downstream via `parse_stage_output`.
///
/// Returns the raw JSON string on success, or `None` if no strategy matched.
pub fn execute(text: &str) -> Option<String> {
    let trimmed = text.trim();

    // Strategy 1: ork fence (highest priority — explicit structured output marker).
    if let Some(json_str) = extract_ork_fence::execute(trimmed) {
        return Some(json_str);
    }

    // Strategy 2: strip markdown fences and parse as JSON, require "type" field.
    // When no fences are present, `strip_markdown_fences` returns `trimmed`, so
    // this also catches plain JSON that the model emitted without any wrapping.
    let stripped = strip_markdown_fences::execute(trimmed);
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&stripped) {
        if value.get("type").and_then(|t| t.as_str()).is_some() {
            return Some(stripped);
        }
    }

    // Strategy 3: fenced JSON from mixed prose+fence, require "type" field.
    if let Some((_prose, json_str)) = extract_fenced_json::execute(trimmed) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if value.get("type").and_then(|t| t.as_str()).is_some() {
                return Some(json_str);
            }
        }
    }

    None
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_markdown_fenced_json() {
        let text = "```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "done");
    }

    #[test]
    fn extracts_plain_json_with_type_field() {
        let text = "{\"type\":\"summary\",\"content\":\"done\"}";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn returns_none_for_json_without_type_field() {
        // Plain JSON with no "type" field must not be extracted — it could be any JSON object.
        let text = "{\"name\":\"foo\",\"value\":42}";
        assert!(execute(text).is_none());
    }

    #[test]
    fn returns_none_for_fenced_json_without_type_field() {
        let text = "```json\n{\"name\":\"foo\",\"value\":42}\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn extracts_mixed_prose_and_fence() {
        let text =
            "The work is complete.\n\n```json\n{\"type\":\"artifact\",\"content\":\"result\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "artifact");
    }

    #[test]
    fn returns_none_for_prose_fence_without_type_field() {
        // Mixed prose + fenced JSON with no "type" field must not be extracted.
        let text = "Done.\n\n```json\n{\"name\":\"no-type\"}\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn extracts_ork_fence() {
        let text = "```ork\n{\"type\":\"summary\",\"content\":\"via ork\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "via ork");
    }

    #[test]
    fn ork_fence_wins_over_markdown_fence() {
        // When both a ```json fence and an ```ork fence are present, the ork fence wins
        // (strategy 1 — highest priority).
        let text = "```json\n{\"type\":\"from_markdown\",\"content\":\"loses\"}\n\
                    ```\n\n```ork\n{\"type\":\"from_ork\",\"content\":\"wins\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "from_ork");
    }

    #[test]
    fn returns_none_for_plain_text() {
        let text = "Just some plain prose with no JSON structure at all.";
        assert!(execute(text).is_none());
    }
}
