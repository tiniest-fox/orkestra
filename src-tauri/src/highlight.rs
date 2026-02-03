//! Syntax highlighting using syntect.
//!
//! Provides a stateful highlighter with pre-generated CSS for light and dark themes.

use syntect::highlighting::ThemeSet;
use syntect::html::{ClassStyle, ClassedHTMLGenerator};
use syntect::parsing::SyntaxSet;

/// Syntax highlighter with pre-loaded syntaxes and CSS.
///
/// Thread-safe (Send + Sync) - can be shared across Tauri command handlers.
pub struct SyntaxHighlighter {
    syntax_set: SyntaxSet,
    light_css: String,
    dark_css: String,
}

impl SyntaxHighlighter {
    /// Create a new highlighter with default syntaxes and themes.
    ///
    /// Loads:
    /// - Syntaxes: Default syntaxes from syntect (supports most common languages)
    /// - Light theme: `InspiredGitHub`
    /// - Dark theme: base16-ocean.dark
    ///
    /// CSS classes are prefixed with "syn-".
    pub fn new() -> Self {
        let syntax_set = SyntaxSet::load_defaults_newlines();
        let theme_set = ThemeSet::load_defaults();

        // Generate CSS for light theme (InspiredGitHub)
        let light_theme = &theme_set.themes["InspiredGitHub"];
        let light_css = syntect::html::css_for_theme_with_class_style(
            light_theme,
            ClassStyle::SpacedPrefixed { prefix: "syn-" },
        )
        .expect("Failed to generate light theme CSS");

        // Generate CSS for dark theme (base16-ocean.dark)
        let dark_theme = &theme_set.themes["base16-ocean.dark"];
        let dark_css = syntect::html::css_for_theme_with_class_style(
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

    /// Get the pre-generated CSS for the light theme.
    pub fn light_css(&self) -> &str {
        &self.light_css
    }

    /// Get the pre-generated CSS for the dark theme.
    pub fn dark_css(&self) -> &str {
        &self.dark_css
    }

    /// Highlight a single line of code.
    ///
    /// Returns HTML with CSS class spans (e.g., `<span class="syn-keyword">fn</span>`).
    ///
    /// Each line is highlighted independently with no cross-line state.
    /// Falls back to plain text for unknown extensions.
    pub fn highlight_line(&self, line: &str, extension: &str) -> String {
        let syntax = self
            .syntax_set
            .find_syntax_by_extension(extension)
            .unwrap_or_else(|| self.syntax_set.find_syntax_plain_text());

        // Create a fresh generator for this line (no cross-line state)
        let mut generator = ClassedHTMLGenerator::new_with_class_style(
            syntax,
            &self.syntax_set,
            ClassStyle::SpacedPrefixed { prefix: "syn-" },
        );

        if let Err(e) = generator.parse_html_for_line_which_includes_newline(line) {
            eprintln!("Syntax highlighting parse error: {e}");
            // Fallback: return plain line (not highlighted)
            return line.to_string();
        }

        generator.finalize()
    }
}

impl Default for SyntaxHighlighter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new() {
        let highlighter = SyntaxHighlighter::new();
        assert!(!highlighter.light_css().is_empty());
        assert!(!highlighter.dark_css().is_empty());
    }

    #[test]
    fn test_highlight_rust() {
        let highlighter = SyntaxHighlighter::new();
        let html = highlighter.highlight_line("fn main() {}\n", "rs");
        assert!(html.contains("syn-"));
        assert!(html.contains("fn"));
    }

    #[test]
    fn test_highlight_unknown_extension() {
        let highlighter = SyntaxHighlighter::new();
        let html = highlighter.highlight_line("Hello, world!\n", "unknown");
        // Should not crash, returns plain text
        assert!(html.contains("Hello, world!"));
    }
}
