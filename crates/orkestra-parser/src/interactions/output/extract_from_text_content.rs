//! Extract structured output from model text content.
//!
//! Tries three strategies in priority order on accumulated model text:
//! markdown fence stripping, fenced JSON from mixed prose, then ork fence.
//! Called by parser implementations after JSONL extraction fails.

use super::{extract_fenced_json, extract_ork_fence, strip_markdown_fences};

/// Try to extract structured JSON from accumulated model text content.
///
/// Applies three strategies in order:
/// 1. Strip markdown fences and parse the contents as JSON (also catches plain JSON).
/// 2. Extract a fenced JSON block from mixed prose+fence text.
/// 3. Extract an ork fence block.
///
/// Returns the raw JSON string on success, or `None` if no strategy matched.
pub fn execute(text: &str) -> Option<String> {
    // Strategy 1: strip markdown fences and parse as JSON.
    // When no fences are present, `strip_markdown_fences` returns `text.trim()`, so
    // this also catches plain JSON that the model emitted without any wrapping.
    let stripped = strip_markdown_fences::execute(text);
    if serde_json::from_str::<serde_json::Value>(&stripped).is_ok() {
        return Some(stripped);
    }

    // Strategy 2: fenced JSON from mixed prose+fence
    if let Some((_prose, json_str)) = extract_fenced_json::execute(text) {
        return Some(json_str);
    }

    // Strategy 3: ork fence
    if let Some(json_str) = extract_ork_fence::execute(text) {
        return Some(json_str);
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
    fn extracts_mixed_prose_and_fence() {
        let text =
            "The work is complete.\n\n```json\n{\"type\":\"artifact\",\"content\":\"result\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "artifact");
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
    fn returns_none_for_plain_text() {
        let text = "Just some plain prose with no JSON structure at all.";
        assert!(execute(text).is_none());
    }

    #[test]
    fn strip_fences_takes_priority_over_ork_fence() {
        // A whole-string markdown fence (strategy 1) should win over an ork fence (strategy 3).
        let text = "```json\n{\"type\":\"from_markdown\",\"content\":\"wins\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "from_markdown");
    }
}
