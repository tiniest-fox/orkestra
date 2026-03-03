//! Syntax highlighting using syntect.
//!
//! Provides server-side syntax highlighting for diff lines using `TextMate` grammars.
//! Generates HTML with CSS classes for styling, supporting both light and dark themes.

use syntect::highlighting::ThemeSet;
use syntect::html::{ClassStyle, ClassedHTMLGenerator};
use syntect::parsing::SyntaxSet;

/// Syntax highlighter that generates CSS-classed HTML.
///
/// All fields are `Send + Sync` and the struct can be shared across threads via `Arc`.
/// CSS is generated once at initialization for both light and dark themes.
pub struct SyntaxHighlighter {
    syntax_set: SyntaxSet,
    /// CSS for light theme (`Solarized (light)`).
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

        let light_theme = &theme_set.themes["Solarized (light)"];
        let light_css = syntect::html::css_for_theme_with_class_style(
            light_theme,
            ClassStyle::SpacedPrefixed { prefix: "syn-" },
        )
        .expect("Failed to generate light theme CSS");

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

    /// Highlight a single line of code.
    ///
    /// Returns HTML with CSS classes. Falls back to HTML-escaped input on failure.
    pub fn highlight_line(&self, line: &str, file_extension: &str) -> String {
        let syntax = self
            .syntax_set
            .find_syntax_by_extension(file_extension)
            .unwrap_or_else(|| self.syntax_set.find_syntax_plain_text());

        let mut generator = ClassedHTMLGenerator::new_with_class_style(
            syntax,
            &self.syntax_set,
            ClassStyle::SpacedPrefixed { prefix: "syn-" },
        );

        if generator
            .parse_html_for_line_which_includes_newline(line)
            .is_err()
        {
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

// -- Helpers --

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
