//! Extract structured output from model text content.
//!
//! Tries three strategies in priority order on accumulated model text:
//! ork fence, markdown fence stripping (also catches plain JSON), then fenced
//! JSON from mixed prose. All strategies require a `"type"` string field.
//! Called by parser implementations after JSONL extraction fails.

use super::{extract_fenced_json, extract_ork_fence, strip_markdown_fences};

/// Outcome of text-content extraction.
#[derive(Debug)]
pub enum TextExtractionResult {
    /// Valid JSON was found.
    Found(String),
    /// Multiple ork fences detected — agent must output exactly one.
    Malformed(String),
}

/// Try to extract structured JSON from accumulated model text content.
///
/// Applies three strategies in priority order:
/// 1. Extract an ork fence block (explicit structured output marker — highest priority).
///    Returns `Malformed` immediately when multiple ork fences are present (checked
///    before extraction so the guard only fires for the ork fence strategy).
/// 2. Strip markdown fences and parse as JSON, requiring a `"type"` string field.
///    When no fences are present, `strip_markdown_fences` returns the trimmed input,
///    so this also catches plain JSON the model emitted without any wrapping.
/// 3. Extract a fenced JSON block from mixed prose+fence text, requiring a `"type"` field.
///
/// All strategies require a `"type"` string field so that arbitrary JSON objects (config
/// snippets, code examples) in the model output are not mistaken for stage output.
/// Schema validation happens downstream via `parse_stage_output`.
///
/// Returns `Some(TextExtractionResult)` on match, `None` when no strategy matched.
pub fn execute(text: &str) -> Option<TextExtractionResult> {
    let trimmed = text.trim();

    // Strategy 1: ork fence (highest priority — explicit structured output marker).
    // Count before extracting so multi-fence fires only on the ork fence strategy,
    // not when strategies 2 or 3 succeed on text that happens to mention ork fences.
    let ork_count = extract_ork_fence::count_ork_fences(trimmed);
    if ork_count > 1 {
        return Some(TextExtractionResult::Malformed(
            "Multiple ork-fenced blocks detected. Output exactly one ork-fenced JSON block per response.".to_string(),
        ));
    }
    if let Some(json_str) = extract_ork_fence::execute(trimmed) {
        return Some(TextExtractionResult::Found(json_str));
    }

    // Strategy 2: strip markdown fences and parse as JSON, require "type" field.
    // When no fences are present, `strip_markdown_fences` returns `trimmed`, so
    // this also catches plain JSON that the model emitted without any wrapping.
    let stripped = strip_markdown_fences::execute(trimmed);
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&stripped) {
        if value.get("type").and_then(|t| t.as_str()).is_some() {
            return Some(TextExtractionResult::Found(stripped));
        }
    }

    // Strategy 3: fenced JSON from mixed prose+fence, require "type" field.
    if let Some((_prose, json_str)) = extract_fenced_json::execute(trimmed) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if value.get("type").and_then(|t| t.as_str()).is_some() {
                return Some(TextExtractionResult::Found(json_str));
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

    fn unwrap_found(result: Option<TextExtractionResult>) -> String {
        match result {
            Some(TextExtractionResult::Found(s)) => s,
            other => panic!("Expected Found, got: {other:?}"),
        }
    }

    #[test]
    fn extracts_markdown_fenced_json() {
        let text = "```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let json_str = unwrap_found(execute(text));
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "done");
    }

    #[test]
    fn extracts_plain_json_with_type_field() {
        let text = "{\"type\":\"summary\",\"content\":\"done\"}";
        let json_str = unwrap_found(execute(text));
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
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
        let json_str = unwrap_found(execute(text));
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
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
        let json_str = unwrap_found(execute(text));
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "via ork");
    }

    #[test]
    fn ork_fence_wins_over_markdown_fence() {
        // When both a ```json fence and an ```ork fence are present, the ork fence wins
        // (strategy 1 — highest priority).
        let text = "```json\n{\"type\":\"from_markdown\",\"content\":\"loses\"}\n\
                    ```\n\n```ork\n{\"type\":\"from_ork\",\"content\":\"wins\"}\n```";
        // Two ork-like structures but only one actual ork fence — still counts the
        // json fence via strategy 2, but ork fence count is 1 so no Malformed.
        // Actually: the ```json fence is not an ork fence, so ork_count = 1. Found wins.
        let json_str = unwrap_found(execute(text));
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "from_ork");
    }

    #[test]
    fn multiple_ork_fences_returns_malformed() {
        let text = "```ork\n{\"type\":\"summary\",\"content\":\"first\"}\n```\n\
                    ```ork\n{\"type\":\"summary\",\"content\":\"second\"}\n```";
        assert!(
            matches!(execute(text), Some(TextExtractionResult::Malformed(_))),
            "Expected Malformed for multiple ork fences"
        );
    }

    #[test]
    fn multi_fence_in_prose_context_still_returns_malformed() {
        // Even with surrounding prose, multiple ork fences → Malformed (not strategy 3)
        let text = "Here is my work:\n\n```ork\n{\"type\":\"a\",\"content\":\"x\"}\n```\n\
                    ```ork\n{\"type\":\"b\",\"content\":\"y\"}\n```";
        assert!(
            matches!(execute(text), Some(TextExtractionResult::Malformed(_))),
            "Expected Malformed for multiple ork fences"
        );
    }

    #[test]
    fn returns_none_for_plain_text() {
        let text = "Just some plain prose with no JSON structure at all.";
        assert!(execute(text).is_none());
    }
}
