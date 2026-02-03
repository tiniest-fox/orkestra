//! Syntax highlighting using syntect.
//!
//! Provides server-side syntax highlighting for diff lines using TextMate grammars.
//! Generates HTML with CSS classes for styling, supporting both light and dark themes.

use syntect::highlighting::{ClassStyle, ClassedHTMLGenerator, ThemeSet};
use syntect::parsing::SyntaxSet;

/// Syntax highlighter that generates CSS-classed HTML.
///
/// The `SyntaxSet` is `Send + Sync` and can be shared across threads via Tauri managed state.
/// CSS is generated once at initialization for both light and dark themes.
pub struct SyntaxHighlighter {
    syntax_set: SyntaxSet,
    /// CSS for light theme (InspiredGitHub).
    pub light_css: String,
    /// CSS for dark theme (base16-ocean.dark).
    pub dark_css: String,
}

impl SyntaxHighlighter {
    /// Create a new syntax highlighter with default syntax set.
    ///
    /// Generates CSS for both light and dark themes at construction time.
    pub fn new() -> Self {
        let syntax_set = SyntaxSet::load_defaults_newlines();
        let theme_set = ThemeSet::load_defaults();

        // Generate CSS for light theme
        let light_theme = &theme_set.themes["InspiredGitHub"];
        let light_css = ClassedHTMLGenerator::get_css_for_theme_with_class_style(
            light_theme,
            ClassStyle::SpacedPrefixed { prefix: "syn-" },
        )
        .expect("Failed to generate light theme CSS");

        // Generate CSS for dark theme
        let dark_theme = &theme_set.themes["base16-ocean.dark"];
        let dark_css = ClassedHTMLGenerator::get_css_for_theme_with_class_style(
            dark_theme,
            ClassStyle::SpacedPrefixed { prefix: "syn-" },
        )
        .expect("Failed to generate dark theme CSS");

        Self {
            syntax_set,
            light_css,
            dark_css,
        }
    }

    /// Highlight a single line of code.
    ///
    /// Returns HTML with CSS classes (e.g., `<span class="syn-keyword">fn</span>`).
    /// Each line is highlighted independently (fresh parser state), so multi-line
    /// constructs may not highlight perfectly — same trade-off as GitHub/GitLab diffs.
    ///
    /// Returns the input unchanged if syntax highlighting fails (e.g., unknown extension).
    pub fn highlight_line(&self, line: &str, file_extension: &str) -> String {
        // Find syntax by file extension
        let syntax = self
            .syntax_set
            .find_syntax_by_extension(file_extension)
            .unwrap_or_else(|| self.syntax_set.find_syntax_plain_text());

        // Generate classed HTML
        let mut generator = ClassedHTMLGenerator::new_with_class_style(
            syntax,
            &self.syntax_set,
            ClassStyle::SpacedPrefixed { prefix: "syn-" },
        );

        if generator.parse_html_for_line_which_includes_newline(line).is_err() {
            // Fallback: return line with HTML entities escaped
            return html_escape(line);
        }

        generator.finalize()
    }
}

impl Default for SyntaxHighlighter {
    fn default() -> Self {
        Self::new()
    }
}

/// Escape HTML entities in a string.
///
/// Syntect already does this when generating HTML, but we need it for the
/// fallback case where highlighting fails.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_highlight_rust() {
        let highlighter = SyntaxHighlighter::new();
        let html = highlighter.highlight_line("fn main() {}\n", "rs");
        assert!(html.contains("syn-"));
    }

    #[test]
    fn test_css_generation() {
        let highlighter = SyntaxHighlighter::new();
        assert!(!highlighter.light_css.is_empty());
        assert!(!highlighter.dark_css.is_empty());
        assert!(highlighter.light_css.contains(".syn-"));
        assert!(highlighter.dark_css.contains(".syn-"));
    }

    #[test]
    fn test_html_escape() {
        assert_eq!(html_escape("<script>"), "&lt;script&gt;");
        assert_eq!(html_escape("a && b"), "a &amp;&amp; b");
    }
}
