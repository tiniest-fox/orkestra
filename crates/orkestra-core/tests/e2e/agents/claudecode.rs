//! End-to-end test for Claude Code running through the real orchestrator.
//!
//! Creates a real task, lets the orchestrator spawn Claude Code, and verifies
//! that logs are persisted and the final artifact is produced.

use std::time::Duration;

use orkestra_core::workflow::{
    config::StageCapabilities,
    domain::{LogEntry, ToolInput},
};

use super::agent_helpers as helpers;

/// Full end-to-end: create a task, let Claude Code work on it, verify logs + artifact.
///
/// Exercises the entire pipeline: task creation → worktree setup → orchestrator
/// spawns Claude Code → stream parsing → log persistence → output parsing → artifact storage.
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_full_orchestrator_run() {
    let env = helpers::AgentTestEnv::new("claudecode/haiku");
    let task_id = env.create_task(
        "List files",
        "List the files in the current directory using ls. Report what you see. Do NOT create or modify any files.",
    );
    env.run_to_completion(&task_id, Duration::from_secs(30));
    env.assert_has_logs(&task_id, "work");
    env.assert_has_artifact(&task_id, "result");
}

/// Session resumption: reject the agent's work, verify it resumes the same
/// session with new logs appended.
///
/// Steps:
/// 1. Run agent to `AwaitingReview` (first work iteration completes)
/// 2. Record session ID, spawn count, and log count
/// 3. Reject with feedback
/// 4. Run agent to `AwaitingReview` again (second iteration)
/// 5. Assert: same `claude_session_id` (session continuity)
/// 6. Assert: `spawn_count` increased (agent was re-spawned)
/// 7. Assert: log count increased (new logs appended, not replaced)
/// 8. Assert: artifact still present
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_session_resume_after_rejection() {
    let env = helpers::AgentTestEnv::new("claudecode/haiku");
    let task_id = env.create_task(
        "List files",
        "List the files in the current directory using ls. Report what you see. Do NOT create or modify any files.",
    );

    // First run
    env.run_to_completion(&task_id, Duration::from_secs(30));

    let session_before = env.get_stage_session(&task_id, "work");
    let logs_before = env.get_log_count(&task_id, "work");
    println!(
        "Before rejection: session_id={}, spawn_count={}, logs={}",
        session_before
            .claude_session_id
            .as_deref()
            .unwrap_or("none"),
        session_before.spawn_count,
        logs_before,
    );

    assert!(logs_before > 0, "Should have logs from first run");
    assert!(
        session_before.spawn_count >= 1,
        "Should have been spawned at least once"
    );

    // Reject and re-run
    env.reject(&task_id, "Please also report the total number of files.");
    env.run_to_completion(&task_id, Duration::from_secs(30));

    let session_after = env.get_stage_session(&task_id, "work");
    let logs_after = env.get_log_count(&task_id, "work");
    println!(
        "After rejection: session_id={}, spawn_count={}, logs={}",
        session_after.claude_session_id.as_deref().unwrap_or("none"),
        session_after.spawn_count,
        logs_after,
    );

    // Same session ID — proves session continuity (resume, not fresh start)
    assert_eq!(
        session_before.claude_session_id, session_after.claude_session_id,
        "Session ID should be preserved across rejection (same Claude session)"
    );

    // Spawn count increased — proves agent was actually re-spawned
    assert!(
        session_after.spawn_count > session_before.spawn_count,
        "Spawn count should increase: before={}, after={}",
        session_before.spawn_count,
        session_after.spawn_count,
    );

    // More logs — proves new activity was appended
    assert!(
        logs_after > logs_before,
        "Log count should increase: before={logs_before}, after={logs_after}"
    );

    // Artifact still present
    env.assert_has_artifact(&task_id, "result");
}

/// Fail-fast: an invalid model name should cause the task to fail immediately
/// with a meaningful error rather than hanging or retrying forever.
///
/// Claude Code emits a stream error event with the API 404 response, which
/// `extract_stream_error()` detects and propagates as a task failure.
#[test]
#[ignore = "requires claude CLI installed"]
fn claudecode_bad_model_fails_fast() {
    let env = helpers::AgentTestEnv::new("claudecode/nonexistent-model-xyz");
    let task_id = env.create_task("Should fail", "This should fail immediately.");
    let reason = env.run_to_failure(&task_id, Duration::from_secs(15));
    assert!(
        reason.contains("not_found") || reason.contains("model"),
        "Failure reason should mention the model error, got: {reason}"
    );
}

// ============================================================================
// Output type tests — verify each StageOutput variant is parsed correctly
// ============================================================================

/// Questions output: agent asks a clarifying question instead of producing an artifact.
///
/// Exercises: questions are always included in all stage schemas, agent outputs questions JSON,
/// parser extracts it, task transitions to `AwaitingReview`
/// with pending questions stored in the iteration outcome.
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_questions_output() {
    let env = helpers::AgentTestEnv::with_capabilities(
        "claudecode/haiku",
        StageCapabilities::default(),
        "You MUST respond with the \"questions\" output type. Ask exactly ONE question: \
         \"What programming language should be used?\" with two options: \"Python\" and \"Rust\". \
         Do NOT attempt any work — ONLY ask the question.",
    );
    let task_id = env.create_task("Set up project", "Help me set up a new project.");
    env.run_to_completion(&task_id, Duration::from_secs(30));

    let questions = env.assert_has_questions(&task_id);
    assert_eq!(questions.len(), 1, "Should have exactly 1 question");
    assert!(
        !questions[0].question.is_empty(),
        "Question text should not be empty"
    );
    assert!(
        questions[0].options.len() >= 2,
        "Question should have at least 2 options, got {}",
        questions[0].options.len()
    );
}

/// Failed output: agent reports that the task cannot be completed.
///
/// Exercises: "failed" type (always in schema), agent outputs failure JSON,
/// parser extracts it, task transitions to Failed status with error message.
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_failed_output() {
    let env = helpers::AgentTestEnv::new("claudecode/haiku");
    let task_id = env.create_task(
        "Impossible task",
        "Read the file /nonexistent/impossible/path_that_does_not_exist_xyz.rs and summarize it. \
         If the file does not exist, you MUST report failure using the \"failed\" output type.",
    );
    let reason = env.run_to_failure(&task_id, Duration::from_secs(30));
    assert!(!reason.is_empty(), "Failure reason should not be empty");
    println!("Failed with reason: {reason}");
}

/// Blocked output: agent reports that it cannot proceed without external resources.
///
/// Exercises: "blocked" type (always in schema), agent outputs blocked JSON,
/// parser extracts it, task transitions to Blocked status with reason.
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_blocked_output() {
    let env = helpers::AgentTestEnv::new("claudecode/haiku");
    let task_id = env.create_task(
        "Blocked task",
        "You MUST immediately report that you are blocked using the \"blocked\" output type. \
         Set the reason to explain that you need access to an external database that is not available. \
         Do NOT attempt any work.",
    );
    let reason = env.run_to_blocked(&task_id, Duration::from_secs(30));
    assert!(!reason.is_empty(), "Blocked reason should not be empty");
    println!("Blocked with reason: {reason}");
}

/// Subtasks output: agent breaks the task into subtasks instead of doing the work directly.
///
/// Exercises: capabilities with `subtasks`, schema includes "subtasks" type,
/// agent outputs subtask breakdown JSON, parser extracts it, task transitions to
/// `AwaitingReview` with the breakdown stored as an artifact.
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_subtasks_output() {
    let env = helpers::AgentTestEnv::with_capabilities(
        "claudecode/haiku",
        StageCapabilities::with_subtasks(),
        "You MUST respond with the \"subtasks\" output type. Break the task into exactly 2 subtasks: \
         (1) title: \"Set up project structure\", description: \"Create directories and config files\" \
         (2) title: \"Implement core logic\", description: \"Write the main module\". \
         Include a brief content summary. Do NOT do any actual work.",
    );
    let task_id = env.create_task(
        "Build calculator",
        "Build a simple calculator library with add and subtract functions.",
    );
    env.run_to_completion(&task_id, Duration::from_secs(30));
    env.assert_has_artifact(&task_id, "result");
}

/// Structured tool call logs: verify that Write and Bash tool uses produce
/// properly typed `ToolInput` variants (not `Other`).
///
/// Exercises: session log parsing → `parse_tool_input()` → `ToolInput::Write`
/// and `ToolInput::Bash` variants with correct fields extracted.
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_structured_tool_call_logs() {
    let env = helpers::AgentTestEnv::new("claudecode/haiku");
    let task_id = env.create_task(
        "Create file and list directory",
        "Use your file Write tool (not bash echo/cat) to create a file called hello.txt \
         with the content 'hello world'. Then use bash to run ls. \
         Report what you see. Do NOT modify any other files.",
    );
    env.run_to_completion(&task_id, Duration::from_secs(30));

    // Verify artifact produced
    env.assert_has_artifact(&task_id, "result");

    // Get structured logs
    let logs = env.get_logs(&task_id, "work");
    assert!(!logs.is_empty(), "Should have log entries");

    // Verify text entries (agent thinking/output)
    let text_entries: Vec<_> = logs
        .iter()
        .filter(|e| matches!(e, LogEntry::Text { .. }))
        .collect();
    assert!(!text_entries.is_empty(), "Should have text entries");

    // Verify tool use entries exist
    let tool_uses: Vec<_> = logs
        .iter()
        .filter(|e| matches!(e, LogEntry::ToolUse { .. }))
        .collect();
    assert!(!tool_uses.is_empty(), "Should have tool use entries");

    // Find a Write tool call targeting hello.txt
    let has_write = logs.iter().any(|e| {
        matches!(
            e,
            LogEntry::ToolUse {
                input: ToolInput::Write { file_path },
                ..
            } if file_path.contains("hello.txt")
        )
    });
    assert!(
        has_write,
        "Should have a Write tool call for hello.txt. Tool uses: {tool_uses:?}"
    );

    // Find a Bash tool call containing ls
    let has_bash_ls = logs.iter().any(|e| {
        matches!(
            e,
            LogEntry::ToolUse {
                input: ToolInput::Bash { command },
                ..
            } if command.contains("ls")
        )
    });
    assert!(
        has_bash_ls,
        "Should have a Bash tool call with ls. Tool uses: {tool_uses:?}"
    );

    // Verify the file was actually created
    let task = env.get_task(&task_id);
    let worktree = task.worktree_path.as_ref().expect("Should have worktree");
    let file_path = std::path::Path::new(worktree).join("hello.txt");
    assert!(file_path.exists(), "hello.txt should exist in worktree");
}

/// Web search tool: verify that `WebSearch` tool uses produce properly typed
/// `ToolInput::WebSearch` variant (not `Other`).
///
/// This test prompts the agent to search the web and verifies the tool call
/// is captured with structured data. If the agent doesn't use web search
/// (non-deterministic), the test still passes if no Other tool calls contain
/// web search data (which would indicate a parsing miss).
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_websearch_tool_logs() {
    let env = helpers::AgentTestEnv::new("claudecode/sonnet");
    let task_id = env.create_task(
        "Search web for info",
        "Use the WebSearch tool to search for 'rust programming language release date'. \
         You MUST use the WebSearch tool - do not try to answer from your training data. \
         Report the year Rust was first released. Only use web search.",
    );
    env.run_to_completion(&task_id, Duration::from_secs(60));

    // Verify artifact produced
    env.assert_has_artifact(&task_id, "result");

    // Get structured logs
    let logs = env.get_logs(&task_id, "work");
    assert!(!logs.is_empty(), "Should have log entries");

    // Check for WebSearch tool call
    let has_websearch = logs.iter().any(|e| {
        matches!(
            e,
            LogEntry::ToolUse {
                input: ToolInput::WebSearch { .. },
                ..
            }
        )
    });

    if has_websearch {
        println!("SUCCESS: Found WebSearch tool call with structured data");
    } else {
        // Agent may not have used web search - verify no Other tool calls
        // contain web search data (would indicate parsing miss)
        let other_tool_uses: Vec<_> = logs
            .iter()
            .filter_map(|e| match e {
                LogEntry::ToolUse {
                    input: ToolInput::Other { summary },
                    tool,
                    ..
                } => Some((tool.as_str(), summary.as_str())),
                _ => None,
            })
            .filter(|(_, summary)| {
                summary.to_ascii_lowercase().contains("websearch")
                    || summary.to_ascii_lowercase().contains("query")
            })
            .collect();

        assert!(
            other_tool_uses.is_empty(),
            "Found Other tool calls that might be WebSearch (parsing miss?): {other_tool_uses:?}"
        );

        println!("Note: Agent did not use web search, but no parsing errors detected");
    }
}

/// Web fetch tool: verify that `WebFetch` tool uses produce properly typed
/// `ToolInput::WebFetch` variant (not `Other`).
///
/// Similar to web search test - verifies the tool is captured with structured data.
#[test]
#[ignore = "requires claude CLI installed + API key"]
fn claudecode_webfetch_tool_logs() {
    let env = helpers::AgentTestEnv::new("claudecode/sonnet");
    let task_id = env.create_task(
        "Fetch web page",
        "Use the WebFetch tool to fetch 'https://www.rust-lang.org'. \
         You MUST use the WebFetch tool - do not try to summarize from memory. \
         Report the title of the page. Only use web fetch.",
    );
    env.run_to_completion(&task_id, Duration::from_secs(60));

    // Verify artifact produced
    env.assert_has_artifact(&task_id, "result");

    // Get structured logs
    let logs = env.get_logs(&task_id, "work");
    assert!(!logs.is_empty(), "Should have log entries");

    // Check for WebFetch tool call
    let has_webfetch = logs.iter().any(|e| {
        matches!(
            e,
            LogEntry::ToolUse {
                input: ToolInput::WebFetch { .. },
                ..
            }
        )
    });

    if has_webfetch {
        println!("SUCCESS: Found WebFetch tool call with structured data");
    } else {
        // Agent may not have used web fetch - verify no Other tool calls
        // contain web fetch data (would indicate parsing miss)
        let other_tool_uses: Vec<_> = logs
            .iter()
            .filter_map(|e| match e {
                LogEntry::ToolUse {
                    input: ToolInput::Other { summary },
                    tool,
                    ..
                } => Some((tool.as_str(), summary.as_str())),
                _ => None,
            })
            .filter(|(_, summary)| {
                summary.to_ascii_lowercase().contains("webfetch")
                    || summary.to_ascii_lowercase().contains("rust-lang.org")
            })
            .collect();

        assert!(
            other_tool_uses.is_empty(),
            "Found Other tool calls that might be WebFetch (parsing miss?): {other_tool_uses:?}"
        );

        println!("Note: Agent did not use web fetch, but no parsing errors detected");
    }
}
