//! Strip markdown code fences from a string.

/// Strip markdown code fences from a string.
///
/// Handles patterns like:
/// - ```json\n{...}\n```
/// - ```\n{...}\n```
pub fn execute(s: &str) -> String {
    let trimmed = s.trim();

    // Check if it starts with ``` and ends with ```
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        // Find the end of the opening fence line
        let start = trimmed.find('\n').map_or(3, |i| i + 1);
        // Find the start of the closing fence
        let end = trimmed.rfind("\n```").unwrap_or(trimmed.len() - 3);

        if start < end {
            return trimmed[start..end].trim().to_string();
        }
    }

    trimmed.to_string()
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
}
