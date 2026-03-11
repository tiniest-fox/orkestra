//! Asynchronous agent execution with event streaming.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;

use orkestra_parser::interactions::output::check_api_error;
use orkestra_parser::interactions::stream::parse_resume_marker;
use orkestra_parser::{parse_completion, AgentParser, StageOutput};
use orkestra_process::ProcessHandle;
use orkestra_types::domain::LogEntry;

use crate::orkestra_debug;
use crate::registry::ProviderRegistry;
use crate::types::{RunConfig, RunError, RunEvent};

use super::run_sync::{collect_stderr, stderr_error_message};

/// Run an agent asynchronously with events.
pub fn execute(
    registry: &Arc<ProviderRegistry>,
    config: RunConfig,
) -> Result<(u32, Receiver<RunEvent>), RunError> {
    orkestra_debug!(
        "runner",
        "run_async: session_id={:?}, is_resume={}, model={:?}",
        config.session_id,
        config.is_resume,
        config.model
    );

    // Resolve provider from model spec
    let resolved = registry
        .resolve(config.model.as_deref())
        .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

    // Create the provider-specific parser
    let parser = registry
        .create_parser(&resolved.provider_name)
        .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

    // Parse the schema for validation (before build_process_config consumes config)
    let schema: Option<serde_json::Value> = serde_json::from_str(&config.json_schema).ok();

    // Build process config with resolved model ID (extracts prompt and working_dir)
    let (process_config, prompt, working_dir) =
        super::build_process_config::execute(config, resolved.model_id);

    // Spawn the process via the resolved provider's spawner
    let mut handle = resolved
        .spawner
        .spawn(&working_dir, process_config)
        .map_err(RunError::from)?;

    let pid = handle.pid;

    orkestra_debug!("runner", "run_async: spawned pid={}", pid);

    // Write prompt to stdin
    handle
        .write_prompt(&prompt)
        .map_err(|e| RunError::PromptWriteFailed(e.to_string()))?;

    // Create event channel
    let (tx, rx) = mpsc::channel();

    // Emit the prompt as a UserMessage log entry (before streaming starts).
    // This is provider-agnostic — every provider gets the user message logged.
    if let Some(marker) = parse_resume_marker::execute(&prompt) {
        let _ = tx.send(RunEvent::LogLine(LogEntry::UserMessage {
            resume_type: marker.marker_type.as_str().to_string(),
            content: marker.content,
        }));
    }

    // Spawn background thread to read output and emit log events
    thread::spawn(move || {
        read_output_and_send_events(handle, &tx, schema.as_ref(), parser);
    });

    Ok((pid, rx))
}

// -- Helpers --

/// Read output from process, parse stream lines, and send events.
fn read_output_and_send_events(
    mut handle: ProcessHandle,
    tx: &Sender<RunEvent>,
    schema: Option<&serde_json::Value>,
    mut parser: Box<dyn AgentParser>,
) {
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

    let stream_result = stream_stdout_lines(&mut handle, tx, &mut *parser);

    let Some((full_output, line_count)) = stream_result else {
        return; // Aborted early (error event or channel closed)
    };

    flush_finalized_entries(&mut *parser, tx);
    handle.disarm();

    send_completion(
        tx,
        &*parser,
        schema,
        &full_output,
        line_count,
        stderr_handle,
    );
}

/// Read stdout lines, parse through the agent parser, and send log events.
///
/// Returns `Some((full_output, line_count))` when the stream ends normally.
/// Returns `None` if aborted early (stream error detected, read failure, or
/// channel closed).
fn stream_stdout_lines(
    handle: &mut ProcessHandle,
    tx: &Sender<RunEvent>,
    parser: &mut dyn AgentParser,
) -> Option<(String, usize)> {
    let mut full_output = String::new();
    let mut line_count: usize = 0;

    for line_result in handle.lines() {
        match line_result {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                line_count += 1;

                if let Some(error_msg) = check_api_error::execute(&line) {
                    orkestra_debug!("runner", "Agent error detected: {}", error_msg);
                    let _ = tx.send(RunEvent::Completed(Err(error_msg)));
                    return None;
                }

                let update = parser.parse_line(&line);

                if let Some(sid) = update.session_id {
                    orkestra_debug!("runner", "Extracted session ID: {}", sid);
                    if tx.send(RunEvent::SessionId(sid)).is_err() {
                        return None;
                    }
                }

                for entry in update.log_entries {
                    if tx.send(RunEvent::LogLine(entry)).is_err() {
                        return None;
                    }
                }

                full_output.push_str(&line);
                full_output.push('\n');
            }
            Err(e) => {
                orkestra_debug!("runner", "Error reading stdout: {}", e);
                let _ = tx.send(RunEvent::Completed(Err(format!(
                    "Failed to read agent output: {e}"
                ))));
                return None;
            }
        }
    }

    Some((full_output, line_count))
}

/// Flush any buffered entries from the parser's `finalize()` as log events.
fn flush_finalized_entries(parser: &mut dyn AgentParser, tx: &Sender<RunEvent>) {
    let finalized = parser.finalize();
    orkestra_debug!("runner", "finalize produced {} entries", finalized.len());
    for entry in finalized {
        if tx.send(RunEvent::LogLine(entry)).is_err() {
            return;
        }
    }
}

/// Parse the agent's full output into a `StageOutput` and send the completion event.
fn send_completion(
    tx: &Sender<RunEvent>,
    parser: &dyn AgentParser,
    schema: Option<&serde_json::Value>,
    full_output: &str,
    line_count: usize,
    stderr_handle: Option<thread::JoinHandle<Vec<String>>>,
) {
    let stderr_lines = collect_stderr(stderr_handle);

    orkestra_debug!(
        "runner",
        "stream ended: {} lines, output_len={}",
        line_count,
        full_output.len()
    );

    if line_count == 0 {
        let error_msg = stderr_error_message(&stderr_lines);
        orkestra_debug!("runner", "Zero stdout lines — agent crashed: {}", error_msg);
        let _ = tx.send(RunEvent::Completed(Err(error_msg)));
        return;
    }

    let result = match schema {
        Some(s) => parse_completion(parser, full_output, s),
        None => parser.extract_output(full_output).and_then(|json_str| {
            StageOutput::parse_unvalidated(&json_str).map_err(|e| e.to_string())
        }),
    };

    let result = result.map_err(|e| {
        orkestra_debug!(
            "runner",
            "parse failed — raw output ({} bytes):\n{}",
            full_output.len(),
            full_output
        );
        format!("{e}\n\nRaw output:\n{full_output}")
    });

    orkestra_debug!("runner", "parse result: {:?}", result.is_ok());

    if tx.send(RunEvent::Completed(result)).is_err() {
        orkestra_debug!("runner", "Channel closed before completion could be sent");
    }
}
