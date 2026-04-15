//! Extract a fenced JSON code block from mixed prose+fence text.

/// Extract a fenced JSON code block from text that contains both prose and a
/// markdown code fence.
///
/// Returns `Some((prose_before, json_string))` when the text contains an
/// embedded fence with valid JSON. Returns `None` when:
/// - The entire string is already a fence (defer to `strip_markdown_fences`)
/// - No fence is found in the text
/// - The fenced content is not valid JSON
///
/// Handles JSON content containing embedded markdown code fences by trying each
/// candidate closing position from furthest to nearest and validating JSON at
/// each candidate.
pub fn execute(text: &str) -> Option<(String, String)> {
    let trimmed = text.trim();

    // Skip when the whole string is already a fence — let the existing
    // `strip_markdown_fences` path handle it.
    if trimmed.starts_with("```") {
        return None;
    }

    // Look for a fence that starts on its own line within the text.
    let fence_start = trimmed.find("\n```")?;
    let after_backticks = fence_start + 1; // position of the opening ```

    // Find the end of the opening fence line (skip optional lang tag like ```json)
    let fence_line_end = trimmed[after_backticks..]
        .find('\n')
        .map(|i| after_backticks + i + 1)?;

    let content_slice = &trimmed[fence_line_end..];

    // Collect all candidate closing positions and try from furthest to nearest.
    // A premature closing position truncates the JSON, making it invalid; the
    // real closing fence produces valid JSON.
    let candidates = fence_close_positions(content_slice);

    let mut json_str: Option<String> = None;

    for &offset in candidates.iter().rev() {
        let candidate = content_slice[..offset].trim();
        if !candidate.is_empty() && serde_json::from_str::<serde_json::Value>(candidate).is_ok() {
            json_str = Some(candidate.to_string());
            break;
        }
    }

    // End-of-string fallback: closing ``` without a preceding newline
    if json_str.is_none() && content_slice.ends_with("```") {
        let candidate = content_slice[..content_slice.len() - 3].trim();
        if !candidate.is_empty() && serde_json::from_str::<serde_json::Value>(candidate).is_ok() {
            json_str = Some(candidate.to_string());
        }
    }

    let json_str = json_str?;
    let prose = trimmed[..fence_start].trim().to_string();
    Some((prose, json_str))
}

// -- Helpers --

/// Collect all byte offsets where a newline followed by triple backticks appears in `s`.
pub(super) fn fence_close_positions(s: &str) -> Vec<usize> {
    let mut positions = Vec::new();
    let mut start = 0;
    while start < s.len() {
        match s[start..].find("\n```") {
            Some(pos) => {
                positions.push(start + pos);
                start += pos + 1;
            }
            None => break,
        }
    }
    positions
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_helper_extracts_fenced_json() {
        let text =
            "The fix is complete.\n\n```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let (prose, json_str) = result.unwrap();
        assert_eq!(prose, "The fix is complete.");
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn mixed_helper_works_without_lang_tag() {
        let text = "Done.\n\n```\n{\"type\":\"artifact\",\"content\":\"x\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let (_prose, json_str) = result.unwrap();
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "artifact");
    }

    #[test]
    fn mixed_helper_returns_none_for_whole_fence() {
        let text = "```json\n{\"type\":\"summary\"}\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn mixed_helper_returns_none_for_non_json_fence() {
        let text = "Some text\n\n```\nnot json at all\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn mixed_helper_returns_none_for_no_fence() {
        let text = "Just some plain text without any fences";
        assert!(execute(text).is_none());
    }

    #[test]
    fn nested_fence_in_json_content() {
        let json_content = serde_json::json!({
            "type": "summary",
            "content": "```python\ndef hello():\n    pass\n```"
        })
        .to_string();
        let text = format!("Here is my output:\n\n```json\n{json_content}\n```");
        let result = execute(&text);
        assert!(result.is_some());
        let (prose, json_str) = result.unwrap();
        assert_eq!(prose, "Here is my output:");
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
    }
}
