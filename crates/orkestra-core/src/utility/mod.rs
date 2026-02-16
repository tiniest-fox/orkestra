//! Lightweight AI utility tasks.
//!
//! This module provides a system for simple, single-turn AI operations like:
//! - Title generation
//! - Commit message generation
//!
//! Each utility task is defined by a folder containing:
//! - `prompt.md` - Handlebars template for the prompt
//! - `schema.json` - JSON schema for structured output
//!
//! Example folder structure:
//! ```text
//! prompts/templates/utilities/
//!   generate_title/
//!     prompt.md
//!     schema.json
//! ```

use std::io::{BufRead, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use handlebars::Handlebars;
use serde_json::Value;

use orkestra_process::{spawn_stderr_reader, ProcessGuard};

/// Shared output format template for all utility tasks.
const OUTPUT_FORMAT_TEMPLATE: &str =
    include_str!("../prompts/templates/utilities/output_format.md");

/// Built-in utility task definitions.
///
/// Each task is defined by `include_str!` macros loading the prompt and schema.
pub mod tasks {
    /// Title generation task.
    pub mod generate_title {
        pub const PROMPT: &str =
            include_str!("../prompts/templates/utilities/generate_title/prompt.md");
        pub const SCHEMA: &str =
            include_str!("../prompts/templates/utilities/generate_title/schema.json");
    }

    /// Commit message generation task.
    pub mod generate_commit_message {
        pub const PROMPT: &str =
            include_str!("../prompts/templates/utilities/generate_commit_message/prompt.md");
        pub const SCHEMA: &str =
            include_str!("../prompts/templates/utilities/generate_commit_message/schema.json");
    }

    /// PR description generation task.
    pub mod generate_pr_description {
        pub const PROMPT: &str =
            include_str!("../prompts/templates/utilities/generate_pr_description/prompt.md");
        pub const SCHEMA: &str =
            include_str!("../prompts/templates/utilities/generate_pr_description/schema.json");
    }
}

/// Error type for utility task execution.
#[derive(Debug, Clone)]
pub enum UtilityError {
    /// Failed to spawn the Claude process.
    SpawnFailed(String),
    /// I/O error during communication.
    IoError(String),
    /// Task timed out.
    Timeout,
    /// Failed to parse output.
    ParseError(String),
    /// Schema is invalid.
    SchemaError(String),
    /// Output failed schema validation.
    ValidationFailed(String),
    /// Task definition not found.
    TaskNotFound(String),
}

impl std::fmt::Display for UtilityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SpawnFailed(msg) => write!(f, "Failed to spawn process: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::Timeout => write!(f, "Task timed out"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::SchemaError(msg) => write!(f, "Schema error: {msg}"),
            Self::ValidationFailed(msg) => write!(f, "Validation failed: {msg}"),
            Self::TaskNotFound(name) => write!(f, "Task not found: {name}"),
        }
    }
}

impl std::error::Error for UtilityError {}

/// Runner for utility tasks.
///
/// Executes lightweight AI tasks with structured JSON output.
pub struct UtilityRunner {
    timeout_secs: u64,
    model: String,
}

impl Default for UtilityRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl UtilityRunner {
    /// Create a new utility runner with default settings.
    pub fn new() -> Self {
        Self {
            timeout_secs: 30,
            model: "haiku".to_string(),
        }
    }

    /// Set the timeout in seconds.
    #[must_use]
    pub fn with_timeout(mut self, secs: u64) -> Self {
        self.timeout_secs = secs;
        self
    }

    /// Set the model to use.
    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    /// Run a utility task by name.
    ///
    /// Loads the prompt template and schema from the task folder,
    /// renders the prompt with the provided context, and executes
    /// the task with structured JSON output.
    ///
    /// # Arguments
    /// * `task_name` - Name of the task (e.g., "`generate_title`")
    /// * `context` - JSON object with variables for the prompt template
    ///
    /// # Returns
    /// The validated JSON output from the task.
    pub fn run(&self, task_name: &str, context: &Value) -> Result<Value, UtilityError> {
        // Load task definition
        let (prompt_template, schema_str) = load_task_definition(task_name)?;

        // Parse schema
        let schema: Value = serde_json::from_str(&schema_str)
            .map_err(|e| UtilityError::SchemaError(e.to_string()))?;

        // Render prompt with context
        let mut prompt = render_prompt(&prompt_template, context)?;

        // Inject output format section based on schema
        prompt.push_str(&generate_output_format_section(&schema));

        // Execute task
        let output = self.execute(&prompt, &schema_str)?;

        // Validate output against schema
        validate_output(&output, &schema)?;

        Ok(output)
    }

    /// Execute a task with the given prompt and schema.
    fn execute(&self, prompt: &str, schema: &str) -> Result<Value, UtilityError> {
        // Spawn Claude with lightweight options
        let mut cmd = Command::new("claude");
        cmd.args([
            "--model",
            &self.model,
            "--print",
            "--output-format",
            "json",
            "--json-schema",
            schema,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        // Create new process group so kill_process_tree can clean up descendants
        #[cfg(unix)]
        cmd.process_group(0);

        let mut child = cmd
            .spawn()
            .map_err(|e| UtilityError::SpawnFailed(e.to_string()))?;

        // Guard ensures the process is killed if we return early (timeout, error, panic)
        let guard = ProcessGuard::new(child.id());

        // Write prompt to stdin
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt.as_bytes())
                .map_err(|e| UtilityError::IoError(e.to_string()))?;
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Spawn stderr reader to avoid blocking
        let stderr_handle = spawn_stderr_reader(stderr);

        // Extract structured output
        let output =
            extract_structured_output(stdout, self.timeout_secs).ok_or(UtilityError::Timeout)?;

        // Log stderr if any
        if let Some(handle) = stderr_handle {
            if let Ok(lines) = handle.join() {
                if !lines.is_empty() {
                    crate::orkestra_debug!("utility", "stderr: {}", lines.join("\n"));
                }
            }
        }

        // Wait for process to finish
        let _ = child.wait();
        guard.disarm();

        // Parse output as JSON
        serde_json::from_str(&output).map_err(|e| UtilityError::ParseError(e.to_string()))
    }
}

/// Load a task definition (prompt template and schema).
fn load_task_definition(task_name: &str) -> Result<(String, String), UtilityError> {
    match task_name {
        "generate_title" => Ok((
            tasks::generate_title::PROMPT.to_string(),
            tasks::generate_title::SCHEMA.to_string(),
        )),
        "generate_commit_message" => Ok((
            tasks::generate_commit_message::PROMPT.to_string(),
            tasks::generate_commit_message::SCHEMA.to_string(),
        )),
        "generate_pr_description" => Ok((
            tasks::generate_pr_description::PROMPT.to_string(),
            tasks::generate_pr_description::SCHEMA.to_string(),
        )),
        _ => Err(UtilityError::TaskNotFound(task_name.to_string())),
    }
}

/// Render a prompt template with the given context.
fn render_prompt(template: &str, context: &Value) -> Result<String, UtilityError> {
    let mut hb = Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.render_template(template, context)
        .map_err(|e| UtilityError::ParseError(format!("Template render failed: {e}")))
}

/// Generate an output format section from a JSON schema.
fn generate_output_format_section(schema: &Value) -> String {
    let schema_pretty = serde_json::to_string_pretty(schema).unwrap_or_default();
    let mut hb = Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.render_template(
        OUTPUT_FORMAT_TEMPLATE,
        &serde_json::json!({ "schema": schema_pretty }),
    )
    .unwrap_or_default()
}

/// Validate output against a JSON schema.
fn validate_output(output: &Value, schema: &Value) -> Result<(), UtilityError> {
    let validator =
        jsonschema::Validator::new(schema).map_err(|e| UtilityError::SchemaError(e.to_string()))?;

    let errors: Vec<String> = validator
        .iter_errors(output)
        .map(|e| format!("{} at {}", e, e.instance_path))
        .collect();

    if errors.is_empty() {
        Ok(())
    } else {
        Err(UtilityError::ValidationFailed(errors.join("; ")))
    }
}

/// Extract structured JSON output from Claude's response.
///
/// Handles the JSON output format from Claude Code with `--output-format json`.
fn extract_structured_output(
    stdout: Option<std::process::ChildStdout>,
    timeout_secs: u64,
) -> Option<String> {
    let stdout = stdout?;
    let reader = std::io::BufReader::new(stdout);
    let start = Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    // Channel for non-blocking reads
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in reader.lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let mut full_output = String::new();

    loop {
        if start.elapsed() > timeout {
            break;
        }

        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                full_output.push_str(&line);
                full_output.push('\n');

                // Check for result event which signals completion
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                        break;
                    }
                }
            }
            Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }

    // Extract structured_output from the response
    find_structured_output(&full_output)
}

/// Find the `structured_output` field in Claude's response.
fn find_structured_output(output: &str) -> Option<String> {
    let trimmed = output.trim();

    // Try to parse as JSON array (Claude Code format)
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if let Some(structured) = extract_from_value(&v) {
            return Some(structured);
        }
    }

    // Try newline-delimited JSON (search from end)
    for line in trimmed.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Ok(v) = serde_json::from_str::<Value>(line) {
            if let Some(structured) = extract_from_value(&v) {
                return Some(structured);
            }
        }
    }

    None
}

/// Extract structured output from a JSON value.
fn extract_from_value(v: &Value) -> Option<String> {
    match v {
        Value::Array(arr) => {
            // Search from end for structured_output
            for item in arr.iter().rev() {
                if let Some(result) = extract_from_value(item) {
                    return Some(result);
                }
            }
            None
        }
        Value::Object(_) => {
            // Check for structured_output field
            if let Some(structured) = v.get("structured_output") {
                if !structured.is_null() {
                    return Some(structured.to_string());
                }
            }
            // Check if this object itself looks like our output
            // (has fields from our schema, not Claude metadata)
            if v.get("type").is_none() && v.get("title").is_some() {
                return Some(v.to_string());
            }
            None
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_load_task_definition() {
        let (prompt, schema) = load_task_definition("generate_title").unwrap();
        assert!(prompt.contains("{{description}}"));
        assert!(schema.contains("\"title\""));
    }

    #[test]
    fn test_load_task_definition_not_found() {
        let result = load_task_definition("nonexistent");
        assert!(matches!(result, Err(UtilityError::TaskNotFound(_))));
    }

    #[test]
    fn test_load_task_definition_pr_description() {
        let (prompt, schema) = load_task_definition("generate_pr_description").unwrap();
        assert!(prompt.contains("{{title}}"));
        assert!(prompt.contains("{{description}}"));
        assert!(prompt.contains("{{plan}}"));
        assert!(prompt.contains("{{diff_summary}}"));
        assert!(prompt.contains("{{base_branch}}"));
        assert!(schema.contains("\"title\""));
        assert!(schema.contains("\"body\""));
    }

    #[test]
    fn test_render_prompt() {
        let template = "Generate title for: {{description}}";
        let context = json!({ "description": "Fix the login bug" });
        let result = render_prompt(template, &context).unwrap();
        assert_eq!(result, "Generate title for: Fix the login bug");
    }

    #[test]
    fn test_validate_output_valid() {
        let schema = json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" }
            },
            "required": ["title"]
        });
        let output = json!({ "title": "Fix login bug" });
        assert!(validate_output(&output, &schema).is_ok());
    }

    #[test]
    fn test_validate_output_invalid() {
        let schema = json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" }
            },
            "required": ["title"]
        });
        let output = json!({ "other": "value" });
        assert!(matches!(
            validate_output(&output, &schema),
            Err(UtilityError::ValidationFailed(_))
        ));
    }

    #[test]
    fn test_find_structured_output_direct() {
        let output = r#"{"structured_output": {"title": "Fix bug"}}"#;
        let result = find_structured_output(output);
        assert!(result.is_some());
        let parsed: Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(parsed["title"], "Fix bug");
    }

    #[test]
    fn test_find_structured_output_array() {
        let output = r#"[{"type":"system"},{"structured_output":{"title":"Fix bug"}}]"#;
        let result = find_structured_output(output);
        assert!(result.is_some());
        let parsed: Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(parsed["title"], "Fix bug");
    }

    #[test]
    fn test_find_structured_output_newline() {
        let output = "{\"type\":\"system\"}\n{\"structured_output\":{\"title\":\"Fix bug\"}}";
        let result = find_structured_output(output);
        assert!(result.is_some());
    }
}
