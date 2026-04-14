//! Extract structured JSON output from an ork fence (` ```ork ` ... ` ``` `).

/// Extract structured JSON from an ork fence in the given text.
///
/// Searches for `` ```ork\n `` ... `` \n``` `` blocks. When multiple ork fences
/// exist, the **last** one wins — agents may discuss the format in prose before
/// producing actual output.
///
/// Returns `Some(json_string)` when a valid JSON payload is found inside a fence.
/// Returns `None` when:
/// - No ork fence is present
/// - The fence content is not valid JSON
/// - The fence has no content
pub fn execute(text: &str) -> Option<String> {
    let mut last_json: Option<String> = None;
    let mut search_from = 0;

    while search_from < text.len() {
        // Find the next opening ork fence
        let Some(fence_start) = text[search_from..].find("```ork") else {
            break;
        };
        let abs_fence_start = search_from + fence_start;

        // Find the end of the opening fence line (skip optional trailing text like ```ork json)
        let after_tag = abs_fence_start + "```ork".len();
        let Some(newline_pos) = text[after_tag..].find('\n') else {
            break; // No newline after opening fence — malformed
        };
        let content_start = after_tag + newline_pos + 1;

        // Find the closing fence
        let Some(closing_offset) = text[content_start..].find("\n```") else {
            break; // No closing fence
        };
        let content_end = content_start + closing_offset;

        let content = text[content_start..content_end].trim();

        if !content.is_empty() && serde_json::from_str::<serde_json::Value>(content).is_ok() {
            last_json = Some(content.to_string());
        }

        // Advance past this fence's closing ``` to find subsequent fences
        search_from = content_start + closing_offset + "\n```".len();
    }

    last_json
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_fence_extracts_json() {
        let text = "```ork\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn invalid_json_in_fence_returns_none() {
        let text = "```ork\nnot valid json at all\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn multiple_fences_last_wins() {
        let text = "```ork\n{\"type\":\"first\",\"content\":\"a\"}\n```\n\nSome prose\n\n```ork\n{\"type\":\"last\",\"content\":\"b\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "last");
    }

    #[test]
    fn no_fence_returns_none() {
        let text = "Just some plain text without any fences";
        assert!(execute(text).is_none());
    }

    #[test]
    fn ork_with_trailing_text_on_opening_line() {
        let text = "```ork json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn empty_content_returns_none() {
        let text = "```ork\n\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn prose_before_fence_is_ignored() {
        let text =
            "Here is my output:\n\n```ork\n{\"type\":\"artifact\",\"content\":\"result\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "artifact");
    }
}
