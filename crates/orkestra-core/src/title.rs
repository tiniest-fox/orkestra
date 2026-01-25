//! Title generation for tasks.
//!
//! Uses a lightweight Claude instance (haiku model) to generate
//! concise titles from task descriptions.

use std::io::BufRead;
use std::process::{Command, Stdio};

use crate::process::spawn_stderr_reader;
use crate::prompts::build_title_generator_prompt;

/// Generates a title for a task description synchronously using a lightweight Claude instance.
///
/// This spawns Claude with `--model haiku --max-turns 1` to minimize latency and cost.
/// The function blocks until the title is generated or a timeout occurs.
///
/// Returns the generated title string, or an error if generation fails.
pub fn generate_title_sync(description: &str, timeout_secs: u64) -> std::io::Result<String> {
    let prompt = build_title_generator_prompt(description);

    // Spawn Claude with minimal options for fast title generation
    let mut child = Command::new("claude")
        .args([
            "--model",
            "haiku",
            "--max-turns",
            "1",
            "--print",
            "--output-format",
            "stream-json",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Write prompt to stdin
    {
        use std::io::Write as IoWrite;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt.as_bytes())?;
        }
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Spawn stderr reader to avoid blocking
    let stderr_handle = spawn_stderr_reader(stderr);

    // Read stdout and extract the title from JSON output
    let title = extract_title_from_output(stdout, timeout_secs);

    // Log stderr if any
    if let Some(handle) = stderr_handle {
        if let Ok(lines) = handle.join() {
            if !lines.is_empty() {
                eprintln!("Title generator stderr: {}", lines.join("\n"));
            }
        }
    }

    // Wait for process to finish
    let _ = child.wait();

    title.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "Failed to generate title within timeout",
        )
    })
}

/// Extracts the title from Claude's JSON stream output.
/// Looks for assistant message content and extracts the text.
fn extract_title_from_output(
    stdout: Option<std::process::ChildStdout>,
    timeout_secs: u64,
) -> Option<String> {
    let stdout = stdout?;
    let reader = std::io::BufReader::new(stdout);
    let start_time = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    // Channel for non-blocking reads
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in reader.lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let mut title_text = String::new();

    loop {
        if start_time.elapsed() > timeout {
            break;
        }

        match rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(Ok(json_line)) => {
                if json_line.trim().is_empty() {
                    continue;
                }

                // Parse JSON and look for assistant text content
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_line) {
                    // Look for content_block_delta with text
                    if v.get("type").and_then(|t| t.as_str()) == Some("content_block_delta") {
                        if let Some(delta) = v.get("delta") {
                            if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                title_text.push_str(text);
                            }
                        }
                    }

                    // Also check for assistant message with content array
                    if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                        if let Some(message) = v.get("message") {
                            if let Some(content) = message.get("content").and_then(|c| c.as_array())
                            {
                                for item in content {
                                    if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                        if let Some(text) =
                                            item.get("text").and_then(|t| t.as_str())
                                        {
                                            title_text.push_str(text);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Check for result event which signals completion
                    if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                        break;
                    }
                }
            }
            Ok(Err(_)) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }
    }

    // Clean up the title: trim whitespace, remove quotes if present
    let title = title_text.trim();
    if title.is_empty() {
        None
    } else {
        // Remove surrounding quotes if present
        let title = title.trim_matches('"').trim_matches('\'');
        // Remove trailing punctuation
        let title = title.trim_end_matches('.');
        Some(title.to_string())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_extract_title_cleanup() {
        // Test that we properly clean up titles
        let cleaned = "  \"Fix the bug\"  ".trim();
        let cleaned = cleaned.trim_matches('"').trim_matches('\'');
        let cleaned = cleaned.trim_end_matches('.');
        assert_eq!(cleaned, "Fix the bug");
    }
}
