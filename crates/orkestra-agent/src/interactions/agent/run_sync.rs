//! Synchronous agent execution.

use std::sync::Arc;
use std::thread;

use orkestra_parser::interactions::output::check_api_error;

use crate::orkestra_debug;
use crate::registry::ProviderRegistry;
use crate::types::{RunConfig, RunError, RunResult};

use super::classify_output::{self, OutputClassification};

/// Run an agent synchronously (blocking).
pub fn execute(registry: &Arc<ProviderRegistry>, config: RunConfig) -> Result<RunResult, RunError> {
    orkestra_debug!(
        "runner",
        "run_sync: session_id={:?}, is_resume={}, model={:?}",
        config.session_id,
        config.is_resume,
        config.model
    );

    // Resolve provider from model spec
    let resolved = registry
        .resolve(config.model.as_deref())
        .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

    // Create the provider-specific parser
    let mut parser = registry
        .create_parser(&resolved.provider_name)
        .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

    // Parse the schema for validation
    let schema: Option<serde_json::Value> = serde_json::from_str(&config.json_schema).ok();

    // Build process config with resolved model ID (extracts prompt and working_dir)
    let (process_config, prompt, working_dir) =
        super::build_process_config::execute(config, resolved.model_id);

    // Spawn the process via the resolved provider's spawner
    let mut handle = resolved
        .spawner
        .spawn(&working_dir, process_config)
        .map_err(RunError::from)?;

    orkestra_debug!("runner", "run_sync: spawned process");

    // Capture stderr in a background thread so we can use it for error messages
    let stderr_handle = handle.take_stderr().map(|stderr| {
        thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            let mut lines = Vec::new();
            for line in reader.lines().map_while(Result::ok) {
                orkestra_debug!("runner", "stderr: {}", line);
                lines.push(line);
            }
            lines
        })
    });

    // Write prompt to stdin
    handle
        .write_prompt(&prompt)
        .map_err(|e| RunError::PromptWriteFailed(e.to_string()))?;

    // Read all output, parsing through the AgentParser
    let mut full_output = String::new();
    let mut line_count: usize = 0;

    for line_result in handle.lines() {
        match line_result {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                line_count += 1;
                if let Some(error_msg) = extract_stream_error(&line) {
                    return Err(RunError::ExtractionFailed(error_msg));
                }
                parser.parse_line(&line);
                full_output.push_str(&line);
                full_output.push('\n');
            }
            Err(e) => {
                return Err(RunError::OutputReadFailed(e.to_string()));
            }
        }
    }

    parser.finalize();

    // Process completed normally
    handle.disarm();

    // Collect stderr
    let stderr_lines = collect_stderr(stderr_handle);

    orkestra_debug!("runner", "run_sync: output_len={}", full_output.len());

    // If stdout produced nothing, the agent likely crashed. Use stderr for the error.
    if line_count == 0 {
        let error_msg = stderr_error_message(&stderr_lines);
        return Err(RunError::ExtractionFailed(error_msg));
    }

    let parsed_output = match classify_output::execute(&*parser, &full_output, schema.as_ref()) {
        OutputClassification::Success(output) => output,
        OutputClassification::ExtractionFailed(e) => {
            orkestra_debug!(
                "runner",
                "extraction failed — raw output ({} bytes):\n{}",
                full_output.len(),
                full_output
            );
            return Err(RunError::ExtractionFailed(e));
        }
        OutputClassification::ParseFailed(e) => {
            orkestra_debug!(
                "runner",
                "parse failed — raw output ({} bytes):\n{}",
                full_output.len(),
                full_output
            );
            return Err(RunError::ParseFailed(e));
        }
    };

    orkestra_debug!("runner", "run_sync: parsed output successfully");

    Ok(RunResult {
        raw_output: full_output,
        parsed_output,
    })
}

// -- Helpers --

/// Check if a stream JSON line contains an error event from the agent.
fn extract_stream_error(line: &str) -> Option<String> {
    check_api_error::execute(line)
}

/// Join the stderr reader thread and return collected lines.
pub(crate) fn collect_stderr(handle: Option<thread::JoinHandle<Vec<String>>>) -> Vec<String> {
    let Some(handle) = handle else {
        return Vec::new();
    };
    match handle.join() {
        Ok(lines) => {
            if !lines.is_empty() {
                orkestra_debug!("runner", "stderr ({} lines):", lines.len());
                for line in &lines {
                    orkestra_debug!("runner", "  stderr: {}", line);
                }
            }
            lines
        }
        Err(_) => Vec::new(),
    }
}

/// Build an error message from stderr lines when the agent produced no stdout.
pub(crate) fn stderr_error_message(stderr_lines: &[String]) -> String {
    // Look for lines that contain an explicit error message
    for line in stderr_lines {
        let trimmed = line.trim();
        // OpenCode throws named errors like "ProviderModelNotFoundError: ..."
        if trimmed.contains("Error:") || trimmed.contains("error:") {
            return format!("Agent process failed: {trimmed}");
        }
    }
    // Fall back to joining all non-empty stderr as context
    let joined: String = stderr_lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .collect::<Vec<_>>()
        .join(" | ");
    if joined.is_empty() {
        "Agent process exited without producing any output".to_string()
    } else {
        format!("Agent process failed: {joined}")
    }
}
