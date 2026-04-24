//! Asynchronous agent execution with event streaming.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;

use orkestra_parser::interactions::output::check_api_error;
use orkestra_parser::interactions::output::parse_stage_output;
use orkestra_parser::interactions::stream::parse_resume_marker;
use orkestra_parser::{AgentParser, StageOutput};
use orkestra_process::ProcessHandle;
use orkestra_types::domain::LogEntry;

use crate::orkestra_debug;
use crate::registry::ProviderRegistry;
use crate::types::{AgentCompletionError, RunConfig, RunError, RunEvent};

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

    // Clone sections before build_process_config consumes config
    let prompt_sections = config.prompt_sections.clone();

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
            sections: prompt_sections,
        }));
    } else {
        // Raw user message (no marker prefix) — sent directly during workflow stages.
        let _ = tx.send(RunEvent::LogLine(LogEntry::UserMessage {
            resume_type: "user_message".to_string(),
            content: prompt.clone(),
            sections: prompt_sections,
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
                    let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(
                        error_msg,
                    ))));
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
                let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(
                    format!("Failed to read agent output: {e}"),
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
        let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(
            error_msg,
        ))));
        return;
    }

    // Step 1: extract structured output from raw stream. Failure means the agent
    // produced no structured output at all — treat as a crash, not malformed output.
    let json_str = match parser.extract_output(full_output) {
        Ok(s) => s,
        Err(e) => {
            orkestra_debug!(
                "runner",
                "extraction failed — raw output ({} bytes):\n{}",
                full_output.len(),
                full_output
            );
            let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(e))));
            return;
        }
    };

    // Step 2: parse the extracted JSON. Failure means the agent tried to produce
    // structured output but got the format wrong — MalformedOutput triggers the
    // corrective retry loop.
    let result = match schema {
        Some(s) => parse_stage_output::execute(&json_str, s).map_err(|e| e.to_string()),
        None => StageOutput::parse_unvalidated(&json_str).map_err(|e| e.to_string()),
    };

    let result = result.map_err(|e| {
        orkestra_debug!(
            "runner",
            "parse failed — raw output ({} bytes):\n{}",
            full_output.len(),
            full_output
        );
        AgentCompletionError::MalformedOutput(e)
    });

    orkestra_debug!("runner", "parse result: {:?}", result.is_ok());

    if tx.send(RunEvent::Completed(result)).is_err() {
        orkestra_debug!("runner", "Channel closed before completion could be sent");
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use orkestra_parser::types::ParsedUpdate;
    use orkestra_types::domain::LogEntry;

    use super::*;

    struct MockParser {
        extract_result: Result<String, String>,
    }

    impl AgentParser for MockParser {
        fn parse_line(&mut self, _line: &str) -> ParsedUpdate {
            ParsedUpdate {
                log_entries: Vec::new(),
                session_id: None,
            }
        }
        fn finalize(&mut self) -> Vec<LogEntry> {
            Vec::new()
        }
        fn extract_output(&self, _full_output: &str) -> Result<String, String> {
            self.extract_result.clone()
        }
    }

    #[test]
    fn extraction_failure_produces_crash_not_malformed_output() {
        let (tx, rx) = mpsc::channel();
        let parser = MockParser {
            extract_result: Err("no structured output found".to_string()),
        };
        let schema = serde_json::json!({"type": "object", "properties": {"type": {"type": "string"}}, "required": ["type"]});

        send_completion(&tx, &parser, Some(&schema), "just prose output", 5, None);

        let event = rx.recv().unwrap();
        match event {
            RunEvent::Completed(Err(AgentCompletionError::Crash(_))) => {}
            other => panic!("expected Crash, got: {other:?}"),
        }
    }

    #[test]
    fn parse_failure_after_extraction_produces_malformed_output() {
        let (tx, rx) = mpsc::channel();
        // extract_output succeeds but returns invalid JSON for the schema
        let parser = MockParser {
            extract_result: Ok(r#"{"type": "unknown_type_not_in_schema"}"#.to_string()),
        };
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["summary"]}
            },
            "required": ["type"]
        });

        send_completion(&tx, &parser, Some(&schema), "some output", 5, None);

        let event = rx.recv().unwrap();
        match event {
            RunEvent::Completed(Err(AgentCompletionError::MalformedOutput(_))) => {}
            other => panic!("expected MalformedOutput, got: {other:?}"),
        }
    }

    #[test]
    fn successful_extraction_and_parse_produces_completed_ok() {
        let (tx, rx) = mpsc::channel();
        let parser = MockParser {
            extract_result: Ok(r#"{"type": "summary", "content": "done"}"#.to_string()),
        };
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["summary"]},
                "content": {"type": "string"}
            },
            "required": ["type"]
        });

        send_completion(&tx, &parser, Some(&schema), "some output", 5, None);

        let event = rx.recv().unwrap();
        assert!(
            matches!(event, RunEvent::Completed(Ok(_))),
            "expected Ok completion, got: {event:?}"
        );
    }
}
