//! Markdown-to-HTML conversion using pulldown-cmark.
//!
//! Provides GFM-compatible rendering (tables, strikethrough, task lists)
//! so the frontend can render pre-parsed HTML instead of parsing markdown
//! on the main thread.

use pulldown_cmark::{html, Options, Parser};

/// Convert markdown to HTML with GFM extensions enabled.
pub fn markdown_to_html(markdown: &str) -> String {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES;

    let parser = Parser::new_ext(markdown, options);
    let mut html_output = String::with_capacity(markdown.len() * 2);
    html::push_html(&mut html_output, parser);
    html_output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_markdown() {
        let html = markdown_to_html("# Hello\n\nA paragraph.");
        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<p>A paragraph.</p>"));
    }

    #[test]
    fn gfm_table() {
        let md = "| A | B |\n|---|---|\n| 1 | 2 |";
        let html = markdown_to_html(md);
        assert!(html.contains("<table>"));
        assert!(html.contains("<td>1</td>"));
    }

    #[test]
    fn gfm_strikethrough() {
        let html = markdown_to_html("~~deleted~~");
        assert!(html.contains("<del>deleted</del>"));
    }

    #[test]
    fn gfm_task_list() {
        let md = "- [x] done\n- [ ] todo";
        let html = markdown_to_html(md);
        assert!(html.contains("checked"));
    }

    #[test]
    fn raw_html_passes_through() {
        // pulldown-cmark passes raw HTML through by default.
        // This is safe because artifact content is agent-generated, not user-supplied.
        let html = markdown_to_html("<em>emphasis</em>");
        assert!(html.contains("<em>emphasis</em>"));
    }
}
