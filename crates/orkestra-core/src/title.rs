//! Title generation for tasks.
//!
//! Uses a lightweight Claude instance (haiku model) to generate
//! concise titles from task descriptions via the utility task system.

use serde_json::json;

use crate::utility::UtilityRunner;

/// Generates a title for a task description synchronously using a lightweight Claude instance.
///
/// This spawns Claude with `--model haiku --max-turns 1` to minimize latency and cost.
/// Uses structured JSON output with schema validation for reliable results.
///
/// Returns the generated title string, or an error if generation fails.
pub fn generate_title_sync(description: &str, timeout_secs: u64) -> std::io::Result<String> {
    let runner = UtilityRunner::new().with_timeout(timeout_secs);
    let context = json!({ "description": description });

    let output = runner
        .run("generate_title", &context)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    output["title"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing title in output")
        })
}
