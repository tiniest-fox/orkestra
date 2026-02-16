//! Extract text content from an `OpenCode` text/assistant event.

/// Extract text content from a text/assistant event.
///
/// Checks `.part.text` (v1.1+), then `.content`, `.text` (legacy).
pub fn execute(v: &serde_json::Value) -> Option<String> {
    // v1.1+: content in .part.text
    if let Some(text) = v
        .get("part")
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
    {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    // Legacy: .content or .text at top level
    if let Some(text) = v
        .get("content")
        .or_else(|| v.get("text"))
        .and_then(|c| c.as_str())
    {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}
