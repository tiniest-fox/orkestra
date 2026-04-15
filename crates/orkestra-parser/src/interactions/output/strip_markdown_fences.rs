//! Strip markdown code fences from a string.

/// Strip markdown code fences from a string.
///
/// Handles patterns like:
/// - ```json\n{...}\n```
/// - ```\n{...}\n```
///
/// When the content contains embedded markdown code fences, finds the outermost
/// closing fence by selecting the rightmost newline-plus-triple-backtick position
/// where everything after it is only whitespace.
pub fn execute(s: &str) -> String {
    let trimmed = s.trim();

    // Check if it starts with ``` and ends with ```
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        // Find the end of the opening fence line
        let start = trimmed.find('\n').map_or(3, |i| i + 1);

        // Find the outer closing fence: the rightmost \n``` where everything
        // after it is only whitespace (confirming it's the outer fence, not an
        // embedded one).
        let end = find_outer_close(trimmed).unwrap_or(trimmed.len() - 3);

        if start < end {
            return trimmed[start..end].trim().to_string();
        }
    }

    trimmed.to_string()
}

// -- Helpers --

/// Find the byte offset of the outer closing fence marker in `s`.
///
/// Collects all newline-plus-triple-backtick positions and returns the rightmost
/// one where everything after it (the rest of `s`) is only whitespace —
/// confirming it is the outer fence delimiter rather than an embedded inner fence.
fn find_outer_close(s: &str) -> Option<usize> {
    let mut positions: Vec<usize> = Vec::new();
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

    for &candidate in positions.iter().rev() {
        if s[candidate + "\n```".len()..].trim().is_empty() {
            return Some(candidate);
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
    fn test_strip_markdown_code_fences() {
        let input = "```json\n{\"type\": \"skip_breakdown\"}\n```";
        let result = execute(input);
        assert_eq!(result, "{\"type\": \"skip_breakdown\"}");
    }

    #[test]
    fn test_strip_markdown_code_fences_no_lang() {
        let input = "```\n{\"type\": \"approved\"}\n```";
        let result = execute(input);
        assert_eq!(result, "{\"type\": \"approved\"}");
    }

    #[test]
    fn test_strip_markdown_code_fences_none() {
        let input = "{\"type\": \"summary\", \"content\": \"done\"}";
        let result = execute(input);
        assert_eq!(result, input);
    }

    #[test]
    fn nested_fence_in_content() {
        let inner = r#"{"type": "artifact", "content": "```python\ndef hello():\n    pass\n```"}"#;
        let input = format!("```json\n{inner}\n```");
        let result = execute(&input);
        // Should return the full JSON, not truncated at the inner ```
        assert!(serde_json::from_str::<serde_json::Value>(&result).is_ok());
    }
}
