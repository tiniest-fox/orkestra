//! Mock agent runner for testing.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;

use orkestra_parser::StageOutput;
use orkestra_types::domain::LogEntry;

use crate::interface::AgentRunner;
use crate::types::{RunConfig, RunError, RunEvent, RunResult};

// ============================================================================
// MockAgentRunner
// ============================================================================

/// Mock agent runner for testing.
///
/// Allows setting expected outputs for tasks without spawning real processes.
/// Outputs are queued per task and consumed in order.
pub struct MockAgentRunner {
    /// Queue of outputs per `task_id`. Each spawn consumes the next output.
    outputs: Mutex<HashMap<String, Vec<StageOutput>>>,
    /// Queue of outputs that should include `LogLine` events before Completed.
    activity_outputs: Mutex<HashMap<String, Vec<StageOutput>>>,
    /// Queue of outputs that send activity (`LogLine`) then fail.
    failure_with_activity: Mutex<HashMap<String, Vec<String>>>,
    /// Next PID to assign.
    next_pid: AtomicU32,
    /// Recorded calls.
    calls: Mutex<Vec<RunConfig>>,
}

impl Default for MockAgentRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl MockAgentRunner {
    /// Create a new mock agent runner.
    pub fn new() -> Self {
        Self {
            outputs: Mutex::new(HashMap::new()),
            activity_outputs: Mutex::new(HashMap::new()),
            failure_with_activity: Mutex::new(HashMap::new()),
            next_pid: AtomicU32::new(10000),
            calls: Mutex::new(Vec::new()),
        }
    }

    /// Set the output for the next agent spawn for a task.
    /// Can be called multiple times to queue multiple outputs.
    pub fn set_output(&self, task_id: &str, output: StageOutput) {
        self.outputs
            .lock()
            .unwrap()
            .entry(task_id.to_string())
            .or_default()
            .push(output);
    }

    /// Set the output for the next agent spawn, with simulated activity (`LogLine` events).
    /// The mock will send a `LogLine` before the Completed event, triggering `has_activity`.
    pub fn set_output_with_activity(&self, task_id: &str, output: StageOutput) {
        self.activity_outputs
            .lock()
            .unwrap()
            .entry(task_id.to_string())
            .or_default()
            .push(output);
    }

    /// Set the next agent spawn to emit activity (`LogLine`) then fail with the given error.
    /// Tests the scenario where an agent produces streaming output but ultimately fails.
    pub fn set_failure_with_activity(&self, task_id: &str, error: String) {
        self.failure_with_activity
            .lock()
            .unwrap()
            .entry(task_id.to_string())
            .or_default()
            .push(error);
    }

    /// Get recorded calls.
    pub fn calls(&self) -> Vec<RunConfig> {
        self.calls.lock().unwrap().clone()
    }

    /// Clear recorded calls.
    pub fn clear_calls(&self) {
        self.calls.lock().unwrap().clear();
    }

    /// Extract `task_id` from the prompt (looks for "Trak ID: xxx" pattern).
    fn extract_task_id(prompt: &str) -> Option<String> {
        for line in prompt.lines() {
            if line.contains("Trak ID") {
                // Try to extract the ID after the colon
                if let Some(id) = line.split(':').nth(1) {
                    let id = id.trim().trim_matches('*').trim();
                    if !id.is_empty() {
                        return Some(id.to_string());
                    }
                }
            }
        }
        None
    }
}

impl AgentRunner for MockAgentRunner {
    fn run_sync(&self, config: RunConfig) -> Result<RunResult, RunError> {
        // Record the call
        self.calls.lock().unwrap().push(config.clone());

        // Use task_id from config, or extract from prompt as fallback
        let task_id = config
            .task_id
            .clone()
            .or_else(|| Self::extract_task_id(&config.prompt))
            .ok_or_else(|| RunError::SpawnFailed("Could not determine task_id".into()))?;

        // Get and remove the next configured output (consume from queue)
        let output = self
            .outputs
            .lock()
            .unwrap()
            .get_mut(&task_id)
            .and_then(|queue| {
                if queue.is_empty() {
                    None
                } else {
                    Some(queue.remove(0))
                }
            })
            .ok_or_else(|| {
                RunError::SpawnFailed(format!("No output configured for task {task_id}"))
            })?;

        // Generate fake raw output
        let raw_output = serde_json::to_string(&serde_json::json!({
            "structured_output": output_to_json(&output)
        }))
        .unwrap();

        Ok(RunResult {
            raw_output,
            parsed_output: output,
        })
    }

    fn run_async(&self, config: RunConfig) -> Result<(u32, Receiver<RunEvent>), RunError> {
        // Record the call
        self.calls.lock().unwrap().push(config.clone());

        let pid = self.next_pid.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();

        // Use task_id from config, or extract from prompt as fallback
        let task_id = config
            .task_id
            .clone()
            .or_else(|| Self::extract_task_id(&config.prompt));

        // Check failure_with_activity first (send LogLine then error)
        let failure_error = task_id.as_ref().and_then(|id| {
            self.failure_with_activity
                .lock()
                .unwrap()
                .get_mut(id)
                .and_then(|queue| {
                    if queue.is_empty() {
                        None
                    } else {
                        Some(queue.remove(0))
                    }
                })
        });

        if let Some(error) = failure_error {
            // Send a LogLine first to trigger in-memory has_activity
            let _ = tx.send(RunEvent::LogLine(LogEntry::Text {
                content: "Mock agent activity before failure".to_string(),
            }));
            let _ = tx.send(RunEvent::Completed(Err(error)));
            return Ok((pid, rx));
        }

        // Check activity_outputs next (these send LogLine before Completed)
        let activity_output = task_id.as_ref().and_then(|id| {
            self.activity_outputs
                .lock()
                .unwrap()
                .get_mut(id)
                .and_then(|queue| {
                    if queue.is_empty() {
                        None
                    } else {
                        Some(queue.remove(0))
                    }
                })
        });

        if let Some(output) = activity_output {
            // Send a LogLine first to trigger has_activity
            let _ = tx.send(RunEvent::LogLine(LogEntry::Text {
                content: "Mock agent activity".to_string(),
            }));
            let _ = tx.send(RunEvent::Completed(Ok(output)));
        } else {
            // Fall through to existing behavior (non-activity outputs)
            let output = task_id.as_ref().and_then(|id| {
                self.outputs.lock().unwrap().get_mut(id).and_then(|queue| {
                    if queue.is_empty() {
                        None
                    } else {
                        Some(queue.remove(0))
                    }
                })
            });

            if let Some(output) = output {
                // Send LogLine before success to maintain backward compatibility
                // (existing tests rely on has_activity being set)
                let _ = tx.send(RunEvent::LogLine(LogEntry::Text {
                    content: "Mock agent output".to_string(),
                }));
                let _ = tx.send(RunEvent::Completed(Ok(output)));
            } else {
                // No output configured — send error WITHOUT LogLine
                // This simulates an agent killed before producing output
                let err_msg = match task_id {
                    Some(id) => format!("No output configured for task {id}"),
                    None => "No output configured (task_id unknown)".to_string(),
                };
                let _ = tx.send(RunEvent::Completed(Err(err_msg)));
            }
        }

        Ok((pid, rx))
    }
}

// -- Helpers --

/// Convert `StageOutput` to JSON value for mock raw output.
fn output_to_json(output: &StageOutput) -> serde_json::Value {
    match output {
        StageOutput::Artifact { content, .. } => serde_json::json!({
            "type": "artifact",
            "content": content
        }),
        StageOutput::Questions { questions, .. } => serde_json::json!({
            "type": "questions",
            "questions": questions
        }),
        StageOutput::Approval {
            decision, content, ..
        } => serde_json::json!({
            "type": "approval",
            "decision": decision,
            "content": content
        }),
        StageOutput::Subtasks {
            content, subtasks, ..
        } => {
            serde_json::json!({
                "type": "subtasks",
                "content": content,
                "subtasks": subtasks
            })
        }
        StageOutput::Failed { error } => serde_json::json!({
            "type": "failed",
            "error": error
        }),
        StageOutput::Blocked { reason } => serde_json::json!({
            "type": "blocked",
            "reason": reason
        }),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SCHEMA: &str = r#"{"type":"object"}"#;

    #[test]
    fn test_mock_runner_sync() {
        let runner = MockAgentRunner::new();
        runner.set_output(
            "task-1",
            StageOutput::Artifact {
                content: "Done".into(),
                activity_log: None,
                resources: vec![],
            },
        );

        let config = RunConfig::new("/tmp", "**Trak ID**: task-1\nDo the work", TEST_SCHEMA);
        let result = runner.run_sync(config).unwrap();

        assert!(matches!(result.parsed_output, StageOutput::Artifact { .. }));
    }

    #[test]
    fn test_mock_runner_async() {
        let runner = MockAgentRunner::new();
        runner.set_output(
            "task-2",
            StageOutput::Artifact {
                content: "Plan".into(),
                activity_log: None,
                resources: vec![],
            },
        );

        let config = RunConfig::new("/tmp", "**Trak ID**: task-2\nPlan this", TEST_SCHEMA);
        let (pid, rx) = runner.run_async(config).unwrap();

        assert!(pid >= 10000);

        // Collect events
        let mut events = Vec::new();
        while let Ok(event) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
            events.push(event);
        }

        assert!(events
            .iter()
            .any(|e| matches!(e, RunEvent::Completed(Ok(_)))));
    }

    #[test]
    fn test_run_async_emits_user_message_for_orkestra_prompt() {
        let runner = MockAgentRunner::new();
        runner.set_output(
            "task-1",
            StageOutput::Artifact {
                content: "Done".into(),
                activity_log: None,
                resources: vec![],
            },
        );

        let prompt = "<!orkestra:resume:work:feedback>\n\nFix the bug";
        let config = RunConfig::new("/tmp", prompt, TEST_SCHEMA).with_task_id("task-1");
        let (_pid, rx) = runner.run_async(config).unwrap();

        // MockAgentRunner doesn't emit the UserMessage (it's an AgentRunner concern),
        // so test parse_resume_marker directly to verify the runner logic works.
        let marker = orkestra_parser::interactions::stream::parse_resume_marker::execute(prompt);
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type.as_str(), "feedback");
        assert_eq!(marker.content, "Fix the bug");

        // Verify mock still sends completion
        let mut events = Vec::new();
        while let Ok(event) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
            events.push(event);
        }
        assert!(events
            .iter()
            .any(|e| matches!(e, RunEvent::Completed(Ok(_)))));
    }

    #[test]
    fn test_mock_runner_records_calls() {
        let runner = MockAgentRunner::new();
        runner.set_output(
            "task-1",
            StageOutput::Artifact {
                content: "Done".into(),
                activity_log: None,
                resources: vec![],
            },
        );

        let config = RunConfig::new("/tmp", "**Trak ID**: task-1\nDo work", TEST_SCHEMA);
        let _ = runner.run_sync(config);

        let calls = runner.calls();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].prompt.contains("task-1"));
    }
}
