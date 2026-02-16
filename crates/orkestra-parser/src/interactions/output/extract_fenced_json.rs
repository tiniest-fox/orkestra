//! Extract a fenced JSON code block from mixed prose+fence text.

/// Extract a fenced JSON code block from text that contains both prose and a
/// markdown code fence.
///
/// Returns `Some((prose_before, json_string))` when the text contains an
/// embedded fence with valid JSON. Returns `None` when:
/// - The entire string is already a fence (defer to `strip_markdown_fences`)
/// - No fence is found in the text
/// - The fenced content is not valid JSON
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

    // Find the closing ```
    let closing = trimmed[fence_line_end..].find("\n```").or_else(|| {
        // The closing fence might be at the very end without a trailing newline
        if trimmed[fence_line_end..].ends_with("```") {
            Some(
                trimmed[fence_line_end..]
                    .rfind("\n```")
                    .unwrap_or(trimmed[fence_line_end..].len() - 3),
            )
        } else {
            None
        }
    })?;
    let content_end = fence_line_end + closing;

    let json_str = trimmed[fence_line_end..content_end].trim();

    // Validate it's actually JSON
    if serde_json::from_str::<serde_json::Value>(json_str).is_err() {
        return None;
    }

    let prose = trimmed[..fence_start].trim().to_string();
    Some((prose, json_str.to_string()))
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
}
