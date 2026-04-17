//! Title generation for tasks.
//!
//! Provides the `TitleGenerator` trait for injectable title generation,
//! with a production implementation (`ClaudeTitleGenerator`) that uses
//! a lightweight Claude instance, and a mock for testing.

use serde_json::json;

use crate::runner::{ExecutionMode, UtilityRunner};

// =============================================================================
// TitleGenerator Trait
// =============================================================================

/// Trait for generating task titles from descriptions.
///
/// Implementations attempt to produce a concise title. The caller handles
/// fallback to `generate_fallback_title` on failure.
pub trait TitleGenerator: Send + Sync {
    /// Attempt to generate a title from a description.
    ///
    /// Returns `Ok(title)` on success, `Err(reason)` on failure.
    fn generate_title(&self, task_id: &str, description: &str) -> Result<String, String>;
}

// =============================================================================
// Production Implementation
// =============================================================================

/// Production title generator — uses Claude haiku via `UtilityRunner`.
///
/// Spawns Claude in Interactive mode so the agent can use its skills and MCP
/// tools to fetch context from external links (e.g., Asana task URLs).
pub struct ClaudeTitleGenerator;

impl TitleGenerator for ClaudeTitleGenerator {
    fn generate_title(&self, _task_id: &str, description: &str) -> Result<String, String> {
        generate_title_sync(description, 120, ExecutionMode::Interactive)
            .map_err(|e| e.to_string())
    }
}

// =============================================================================
// Mock Implementation (for testing)
// =============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::TitleGenerator;

    /// Mock title generator for testing.
    ///
    /// Can simulate success (returns fallback title) or failure (returns error).
    pub struct MockTitleGenerator {
        fail: bool,
    }

    impl MockTitleGenerator {
        /// Creates a mock that succeeds with a deterministic fallback title.
        pub fn succeeding() -> Self {
            Self { fail: false }
        }

        /// Creates a mock that fails, triggering the caller's fallback path.
        pub fn failing() -> Self {
            Self { fail: true }
        }
    }

    impl TitleGenerator for MockTitleGenerator {
        fn generate_title(&self, _task_id: &str, description: &str) -> Result<String, String> {
            if self.fail {
                Err("Mock title generation failed".into())
            } else {
                Ok(super::generate_fallback_title(description))
            }
        }
    }
}

// =============================================================================
// Title Generation Helpers
// =============================================================================

/// Generates a title synchronously using a lightweight Claude instance.
///
/// `mode` controls whether the agent can use tools (`Interactive`) or runs
/// headless (`SingleTurn`). Pass `Interactive` for task titles so the agent can
/// fetch context from external links; pass `SingleTurn` for plain-text titles
/// (e.g., assistant session names) where tool access is unnecessary.
///
/// Returns the generated title string, or an error if generation fails.
pub fn generate_title_sync(
    description: &str,
    timeout_secs: u64,
    mode: ExecutionMode,
) -> std::io::Result<String> {
    let runner = UtilityRunner::new()
        .with_timeout(timeout_secs)
        .with_mode(mode);
    let context = json!({ "description": description });

    let output = runner
        .run("generate_title", &context)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    output["title"]
        .as_str()
        .map(std::string::ToString::to_string)
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing title in output")
        })
}

/// Generate a fallback title from description when AI generation fails.
///
/// Takes the first ~50 characters, truncated at a word boundary.
pub fn generate_fallback_title(description: &str) -> String {
    let trimmed = description.trim();
    if trimmed.len() <= 50 {
        return trimmed.to_string();
    }

    // Find a good truncation point (space, punctuation) before 50 chars
    let truncated: String = trimmed.chars().take(50).collect();
    if let Some(last_space) = truncated.rfind(|c: char| c.is_whitespace() || c == '.' || c == ',') {
        let result = truncated[..last_space].trim();
        if !result.is_empty() {
            return format!("{result}...");
        }
    }

    // No good break point, just truncate
    format!("{}...", truncated.trim())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fallback_title_short_description() {
        let title = generate_fallback_title("Fix the login bug");
        assert_eq!(title, "Fix the login bug");
    }

    #[test]
    fn test_fallback_title_long_description() {
        let title = generate_fallback_title(
            "Implement a comprehensive user authentication system with OAuth support and session management",
        );
        assert_eq!(title, "Implement a comprehensive user authentication...");
    }

    #[test]
    fn test_fallback_title_truncates_at_word_boundary() {
        let title =
            generate_fallback_title("The quick brown fox jumps over the lazy dog repeatedly");
        assert!(title.ends_with("..."));
        assert!(title.len() <= 53); // 50 + "..."
    }
}
