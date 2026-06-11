//! Heuristic Mermaid block validator — extracts mermaid code blocks from markdown and checks for known syntax issues.

use std::fmt;

use regex::Regex;

// ============================================================================
// Types
// ============================================================================

/// A syntax error found in a mermaid block.
pub struct MermaidError {
    pub block_index: usize,
    pub message: String,
}

impl fmt::Display for MermaidError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Mermaid block {}: {}", self.block_index, self.message)
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Validate mermaid blocks in a markdown string.
///
/// Returns `Ok(())` if all blocks are valid or no mermaid blocks exist.
/// Returns `Err(errors)` with one `MermaidError` per invalid block.
pub fn validate_mermaid_in_markdown(content: &str) -> Result<(), Vec<MermaidError>> {
    let blocks = extract_mermaid_blocks(content);
    let errors: Vec<MermaidError> = blocks
        .into_iter()
        .enumerate()
        .filter_map(|(idx, block)| validate_block(idx + 1, &block))
        .collect();

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn extract_mermaid_blocks(content: &str) -> Vec<String> {
    // Match ```mermaid\n...(content)...``` allowing \r\n line endings
    let re = Regex::new(r"```mermaid\r?\n([\s\S]*?)```").expect("valid regex");
    re.captures_iter(content)
        .map(|cap| cap[1].to_string())
        .collect()
}

fn validate_block(block_index: usize, block: &str) -> Option<MermaidError> {
    // Only validate flowchart/graph diagrams
    let first_line = block.lines().find(|l| !l.trim().is_empty())?;
    let trimmed = first_line.trim();
    if !trimmed.starts_with("graph") && !trimmed.starts_with("flowchart") {
        return None;
    }

    // Match node label expressions: id[label], id(label), id{label} and multi-char openers.
    // The label capture (group 1) tries the quoted-string alternative first so that
    // `"text (with parens)"` is consumed whole — inner `)` never triggers the closer.
    let node_label_re = Regex::new(
        r#"[A-Za-z0-9_]+(?:\[\(|\[\[|\[|\(\[|\(\(|\(|\{)("[^"]*"|[^\]\)\}\n]*?)[\]\)\}]"#,
    )
    .expect("valid regex");

    for caps in node_label_re.captures_iter(block) {
        let label = &caps[1];

        // Quoted labels are safe — the quoted alternative captures the whole "..." string.
        if label.starts_with('"') {
            continue;
        }

        if contains_unbalanced_delimiters(label) {
            return Some(MermaidError {
                block_index,
                message: format!(
                    "unquoted special characters in node label '{}'",
                    label.trim()
                ),
            });
        }
    }

    None
}

/// Returns true if the label string contains any unquoted delimiter characters.
fn contains_unbalanced_delimiters(label: &str) -> bool {
    // Any occurrence of ()[]{}  in an unquoted label is suspicious
    label
        .chars()
        .any(|c| matches!(c, '(' | ')' | '[' | ']' | '{' | '}'))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_mermaid_blocks() {
        assert!(validate_mermaid_in_markdown("# Hello\nSome text").is_ok());
    }

    #[test]
    fn valid_flowchart_quoted_labels() {
        let md = "```mermaid\ngraph TD\n  A[\"label\"] --> B[\"other\"]\n```";
        assert!(validate_mermaid_in_markdown(md).is_ok());
    }

    #[test]
    fn valid_simple_labels() {
        let md = "```mermaid\ngraph TD\n  A[simple text] --> B[another]\n```";
        assert!(validate_mermaid_in_markdown(md).is_ok());
    }

    #[test]
    fn unquoted_parens_in_brackets() {
        let md = "```mermaid\ngraph TD\n  A[text (with parens)] --> B\n```";
        let result = validate_mermaid_in_markdown(md);
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].block_index, 1);
        assert!(errors[0].message.contains("unquoted special characters"));
    }

    #[test]
    fn unquoted_brackets_in_parens() {
        let md = "```mermaid\ngraph TD\n  A(text [with brackets]) --> B\n```";
        let result = validate_mermaid_in_markdown(md);
        assert!(result.is_err());
    }

    #[test]
    fn unquoted_braces() {
        let md = "```mermaid\ngraph TD\n  A[text {with braces}] --> B\n```";
        let result = validate_mermaid_in_markdown(md);
        assert!(result.is_err());
    }

    #[test]
    fn mixed_valid_invalid() {
        let md = concat!(
            "```mermaid\ngraph TD\n  A[simple] --> B[simple]\n```\n\n",
            "```mermaid\ngraph TD\n  A[bad (label)] --> B\n```"
        );
        let result = validate_mermaid_in_markdown(md);
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].block_index, 2);
    }

    #[test]
    fn non_flowchart_skipped() {
        let md = "```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello (world) [test]\n```";
        assert!(validate_mermaid_in_markdown(md).is_ok());
    }

    #[test]
    fn quoted_labels_safe() {
        let md = "```mermaid\ngraph TD\n  A[\"text (with parens)\"] --> B\n```";
        assert!(validate_mermaid_in_markdown(md).is_ok());
    }
}
