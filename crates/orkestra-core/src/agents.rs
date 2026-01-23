use std::fs;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::domain::{Task, TaskStatus};
use crate::project;
use crate::services::Project;
use crate::tasks;

/// Agent types that can be spawned
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AgentType {
    Planner,
    Breakdown,
    Worker,
    Reviewer,
}

/// Builds the prompt for a planner agent
fn build_planner_prompt(task: &Task, agent_definition: &str) -> String {
    let feedback_section = if let Some(feedback) = &task.plan_feedback {
        format!(
            r"

## Previous Plan Feedback

The user has requested changes to the previous plan:

{feedback}

Please revise your plan to address this feedback.
"
        )
    } else {
        String::new()
    };

    let completion_instructions = if task.auto_approve {
        format!(
            r#"Remember: This task has AUTO-APPROVE enabled. When your plan is ready, you MUST run BOTH commands in sequence:
1. `ork task set-plan {task_id} --plan "YOUR_MARKDOWN_PLAN"`
2. `ork task approve {task_id}`

The second command will automatically start the worker agent to implement your plan."#,
            task_id = task.id
        )
    } else {
        format!(
            r#"Remember: When your plan is ready, you MUST run:
`ork task set-plan {task_id} --plan "YOUR_MARKDOWN_PLAN"`"#,
            task_id = task.id
        )
    };

    format!(
        r"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{feedback_section}
---

{completion_instructions}
",
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        feedback_section = feedback_section,
        completion_instructions = completion_instructions,
    )
}

/// Builds the prompt for a worker agent
fn build_worker_prompt(task: &Task, agent_definition: &str, subtasks: Option<&[Task]>) -> String {
    let plan_section = if let Some(plan) = &task.plan {
        format!(
            r"

## Approved Implementation Plan

Follow this plan that was approved by the user:

{plan}
"
        )
    } else {
        String::new()
    };

    let review_feedback_section = if let Some(feedback) = &task.review_feedback {
        format!(
            r"

## Review Feedback

The reviewer has requested changes to your work:

{feedback}

Please address this feedback and continue your implementation."
        )
    } else {
        String::new()
    };

    let subtasks_section = if let Some(subs) = subtasks {
        if subs.is_empty() {
            String::new()
        } else {
            use std::fmt::Write;
            let checklist: String = subs.iter().fold(String::new(), |mut acc, s| {
                let status_marker = if s.status == TaskStatus::Done {
                    "x"
                } else {
                    " "
                };
                let _ = writeln!(
                    acc,
                    "- [{}] **{}**: {} (ID: {})",
                    status_marker, s.title, s.description, s.id
                );
                acc
            });
            format!(
                r"

## Subtasks Checklist

Work through these subtasks in order. Mark each complete as you finish:

{checklist}
To mark a subtask complete, run: `ork task complete-subtask SUBTASK_ID`
"
            )
        }
    } else {
        String::new()
    };

    format!(
        r#"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{plan_section}{subtasks_section}{review_feedback_section}
---

Remember: When you are done with ALL work, you MUST run one of these commands:
- `ork task complete {task_id} --summary "what you did"` - if successful
- `ork task fail {task_id} --reason "why"` - if you cannot complete it
- `ork task block {task_id} --reason "what you need"` - if you need clarification
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        subtasks_section = subtasks_section,
        review_feedback_section = review_feedback_section,
    )
}

/// Builds the prompt for a breakdown agent
fn build_breakdown_prompt(task: &Task, agent_definition: &str) -> String {
    let plan_section = if let Some(plan) = &task.plan {
        format!(
            r"

## Approved Implementation Plan

The following plan has been approved for implementation:

{plan}
"
        )
    } else {
        String::new()
    };

    let feedback_section = if let Some(feedback) = &task.breakdown_feedback {
        format!(
            r"

## Previous Breakdown Feedback

The user has requested changes to the previous breakdown:

{feedback}

Please revise your breakdown to address this feedback.
"
        )
    } else {
        String::new()
    };

    let completion_instructions = if task.auto_approve {
        format!(
            r#"Remember: This task has AUTO-APPROVE enabled. When your breakdown is ready:
1. Create all subtasks using `ork task create-subtask {task_id} --title "..." --description "..."`
2. Run `ork task set-breakdown {task_id} --breakdown "YOUR_BREAKDOWN_SUMMARY"`
3. Run `ork task approve-breakdown {task_id}`"#,
            task_id = task.id
        )
    } else {
        format!(
            r#"Remember: When your breakdown is ready:
1. Create all subtasks using `ork task create-subtask {task_id} --title "..." --description "..."`
2. Run `ork task set-breakdown {task_id} --breakdown "YOUR_BREAKDOWN_SUMMARY"`

If the task is simple and doesn't need subtasks, instead run:
`ork task skip-breakdown {task_id}`"#,
            task_id = task.id
        )
    };

    format!(
        r"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{plan_section}{feedback_section}
---

{completion_instructions}
",
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        feedback_section = feedback_section,
        completion_instructions = completion_instructions,
    )
}

/// Builds the prompt for a reviewer agent
fn build_reviewer_prompt(task: &Task, agent_definition: &str) -> String {
    let plan_section = if let Some(plan) = &task.plan {
        format!(
            r"

## Approved Implementation Plan

The worker followed this plan:

{plan}
"
        )
    } else {
        String::new()
    };

    let summary_section = if let Some(summary) = &task.summary {
        format!(
            r"

## Work Summary

The worker completed the implementation with this summary:

{summary}
"
        )
    } else {
        String::new()
    };

    format!(
        r#"{agent_definition}

---

## Task Under Review

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{plan_section}{summary_section}
---

## Your Review Commands

When you are done reviewing, you MUST run ONE of these commands:
- `ork task approve-review {task_id}` - if the implementation passes all checks and review
- `ork task reject-review {task_id} --feedback "specific feedback for the worker"` - if issues need to be fixed

If you reject, provide clear, actionable feedback so the worker knows exactly what to fix.
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        summary_section = summary_section,
    )
}

/// Finds the ork CLI binary path
fn find_cli_path() -> Option<PathBuf> {
    // First check if ork is in PATH
    if let Ok(output) = Command::new("which").arg("ork").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // Check relative to current directory (development mode)
    let dev_path = std::env::current_dir().ok()?.join("target/debug/ork");
    if dev_path.exists() {
        return Some(dev_path);
    }

    // Check relative to git repo root (for worktrees)
    // Use git rev-parse --show-toplevel to find the actual repo root
    if let Ok(output) = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
    {
        if output.status.success() {
            let repo_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let git_root_path = PathBuf::from(&repo_root).join("target/debug/ork");
            if git_root_path.exists() {
                return Some(git_root_path);
            }
        }
    }

    // Walk up the directory tree looking for target/debug/ork
    // This handles worktrees at .orkestra/worktrees/TASK-XXX where the main
    // repo is at ../../../
    if let Ok(cwd) = std::env::current_dir() {
        let mut path = cwd.as_path();
        while let Some(parent) = path.parent() {
            let candidate = parent.join("target/debug/ork");
            if candidate.exists() {
                return Some(candidate);
            }
            path = parent;
        }
    }

    None
}

/// Loads the agent definition from the agents directory
pub fn load_agent_definition(agent_type: &str) -> std::io::Result<String> {
    // Try project .orkestra/agents/ first
    if let Ok(project_root) = project::find_project_root() {
        let local_path = project_root
            .join(".orkestra/agents")
            .join(format!("{agent_type}.md"));
        if local_path.exists() {
            return fs::read_to_string(local_path);
        }
    }

    // Fall back to home directory for global/default agents
    if let Some(home) = dirs::home_dir() {
        let home_path = home
            .join(".orkestra/agents")
            .join(format!("{agent_type}.md"));
        if home_path.exists() {
            return fs::read_to_string(home_path);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!(
            "Agent definition not found: {agent_type} (searched .orkestra/agents/ and ~/.orkestra/agents/)"
        ),
    ))
}

/// Result of spawning an agent
#[derive(Debug)]
pub struct SpawnedAgent {
    pub task_id: String,
    pub process_id: u32,
    pub session_id: Option<String>,
}

/// Result from parsing a stream event
struct ParsedEvent {
    session_id: Option<String>,
    /// True if this event indicates new content was written to the session file
    has_new_content: bool,
}

/// Parses a streaming JSON event to extract useful information
/// Only fires update events when meaningful content is produced
fn parse_stream_event(json_line: &str) -> ParsedEvent {
    let v: serde_json::Value = match serde_json::from_str(json_line) {
        Ok(v) => v,
        Err(_) => {
            return ParsedEvent {
                session_id: None,
                has_new_content: false,
            }
        }
    };

    let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    // Check for system init events which contain session_id
    if event_type == "system" && v.get("subtype").and_then(|s| s.as_str()) == Some("init") {
        let session_id = v
            .get("session_id")
            .and_then(|s| s.as_str())
            .map(std::string::ToString::to_string);
        return ParsedEvent {
            session_id,
            has_new_content: true,
        };
    }

    // Check for assistant message events (these are written to session file)
    // The "assistant" type with a "message" field indicates a complete message
    if event_type == "assistant" {
        // Check if it has actual content (not just status)
        if v.get("message").is_some() {
            return ParsedEvent {
                session_id: None,
                has_new_content: true,
            };
        }
    }

    // Check for result events (tool results, which update the session)
    if event_type == "result" {
        return ParsedEvent {
            session_id: None,
            has_new_content: true,
        };
    }

    ParsedEvent {
        session_id: None,
        has_new_content: false,
    }
}

// =============================================================================
// Agent Configuration & Spawn Helpers
// =============================================================================

/// Configuration resolved for spawning an agent
struct AgentConfig {
    prompt: String,
    status: TaskStatus,
    session_type: &'static str,
}

/// Resolves agent configuration: loads definition, builds prompt, determines status
fn resolve_agent_config(
    project: &Project,
    task: &Task,
    agent_type: AgentType,
) -> std::io::Result<AgentConfig> {
    let agent_name = match agent_type {
        AgentType::Planner => "planner",
        AgentType::Breakdown => "breakdown",
        AgentType::Worker => "worker",
        AgentType::Reviewer => "reviewer",
    };
    let agent_def = load_agent_definition(agent_name)?;

    let prompt = match agent_type {
        AgentType::Planner => build_planner_prompt(task, &agent_def),
        AgentType::Breakdown => build_breakdown_prompt(task, &agent_def),
        AgentType::Worker => {
            let subtasks = tasks::get_subtasks(project, &task.id).ok();
            build_worker_prompt(task, &agent_def, subtasks.as_deref())
        }
        AgentType::Reviewer => build_reviewer_prompt(task, &agent_def),
    };

    let status = match agent_type {
        AgentType::Planner => TaskStatus::Planning,
        AgentType::Breakdown => TaskStatus::BreakingDown,
        AgentType::Worker => TaskStatus::Working,
        AgentType::Reviewer => TaskStatus::Reviewing,
    };

    let session_type = match agent_type {
        AgentType::Planner => "plan",
        AgentType::Breakdown => "breakdown",
        AgentType::Worker => "work",
        AgentType::Reviewer => "review",
    };

    Ok(AgentConfig {
        prompt,
        status,
        session_type,
    })
}

/// Prepares the PATH environment variable with the CLI directory
fn prepare_path_env() -> String {
    let cli_path = find_cli_path();
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(ref cli) = cli_path {
        if let Some(parent) = cli.parent() {
            path_env = format!("{}:{}", parent.display(), path_env);
        }
    }
    path_env
}

/// Spawns a Claude process with common arguments
fn spawn_claude_process(
    project_root: &std::path::Path,
    path_env: &str,
    resume_session: Option<&str>,
) -> std::io::Result<std::process::Child> {
    let mut cmd = Command::new("claude");

    if let Some(session_id) = resume_session {
        cmd.args(["--resume", session_id]);
    }

    cmd.args([
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
    ])
    .env("PATH", path_env)
    .current_dir(project_root)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
}

/// Writes prompt to stdin and closes it
fn write_prompt_to_stdin(child: &mut std::process::Child, prompt: &str) -> std::io::Result<()> {
    use std::io::Write as IoWrite;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
    }
    Ok(())
}

/// Spawns a thread to read stderr and collect lines
fn spawn_stderr_reader(
    stderr: Option<std::process::ChildStderr>,
) -> Option<std::thread::JoinHandle<Vec<String>>> {
    stderr.map(|stderr| {
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            let mut lines = Vec::new();
            for line in reader.lines().map_while(std::result::Result::ok) {
                lines.push(line);
            }
            lines
        })
    })
}

/// Logs stderr output if present
fn log_stderr(
    task_id: &str,
    prefix: &str,
    stderr_handle: Option<std::thread::JoinHandle<Vec<String>>>,
) {
    if let Some(handle) = stderr_handle {
        if let Ok(lines) = handle.join() {
            if !lines.is_empty() {
                eprintln!("{} {} stderr: {}", prefix, task_id, lines.join("\n"));
            }
        }
    }
}

// =============================================================================
// Spawn Functions
// =============================================================================

/// Spawns a Claude Code agent to work on a task
/// The `on_update` callback is called whenever there's new output (for real-time UI updates)
/// If the task has a `worktree_path`, the agent will be spawned in that directory.
pub fn spawn_agent<F>(
    project: &Project,
    task: &Task,
    agent_type: AgentType,
    on_update: F,
) -> std::io::Result<SpawnedAgent>
where
    F: Fn(&str) + Send + 'static,
{
    let config = resolve_agent_config(project, task, agent_type)?;
    tasks::update_task_status(project, &task.id, config.status)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let path_env = prepare_path_env();
    let project_root = project.root().to_path_buf();
    let task_id = task.id.clone();

    // Use task's worktree_path if available, otherwise fall back to project_root
    let cwd = task
        .worktree_path
        .as_ref()
        .map_or(project_root, PathBuf::from);

    let mut child = spawn_claude_process(&cwd, &path_env, None)?;
    write_prompt_to_stdin(&mut child, &config.prompt)?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session_type = config.session_type.to_string();

    // Record the PID immediately so orchestrator knows agent is running
    // Note: Background thread will use its own Project instance for subsequent updates
    let _ = tasks::set_agent_pid(project, &task_id, Some(pid));

    let task_id_for_callback = task_id.clone();

    // Spawn background thread for stdout/stderr processing
    // Each thread gets its own Project instance (SQLite handles concurrent access)
    std::thread::spawn(move || {
        // Create a Project instance for this thread
        let thread_project = match Project::discover() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("Failed to discover project in agent thread: {e}");
                return;
            }
        };

        let stderr_handle = spawn_stderr_reader(stderr);

        if let Some(stdout) = stdout {
            let reader = std::io::BufReader::new(stdout);
            for json_line in reader.lines().map_while(std::result::Result::ok) {
                if json_line.trim().is_empty() {
                    continue;
                }
                let parsed = parse_stream_event(&json_line);
                if let Some(sid) = parsed.session_id {
                    let _ = tasks::add_task_session(
                        &thread_project,
                        &task_id,
                        &session_type,
                        &sid,
                        Some(pid),
                    );
                }
                if parsed.has_new_content {
                    on_update(&task_id_for_callback);
                }
            }
        }

        log_stderr(&task_id, "Agent", stderr_handle);

        match child.wait() {
            Ok(status) => {
                eprintln!(
                    "Agent {} finished with exit code: {:?}",
                    task_id,
                    status.code()
                );
                // Clear the PID now that agent is done
                let _ = tasks::set_agent_pid(&thread_project, &task_id, None);
                on_update(&task_id_for_callback);
            }
            Err(e) => {
                eprintln!("Agent {task_id} error: {e}");
                // Clear the PID even on error
                let _ = tasks::set_agent_pid(&thread_project, &task_id, None);
                on_update(&task_id_for_callback);
            }
        }
    });

    Ok(SpawnedAgent {
        task_id: task.id.clone(),
        process_id: pid,
        session_id: None,
    })
}

/// Spawns a Claude Code agent and waits for session initialization before returning.
/// This is useful for CLI contexts where we need to ensure the `session_id` is captured
/// before the calling process exits.
///
/// Returns the `SpawnedAgent` with `session_id` populated.
/// The agent continues running in the background after this returns.
/// If the task has a `worktree_path`, the agent will be spawned in that directory.
pub fn spawn_agent_sync(
    project: &Project,
    task: &Task,
    agent_type: AgentType,
    timeout_secs: u64,
) -> std::io::Result<SpawnedAgent> {
    let config = resolve_agent_config(project, task, agent_type)?;
    tasks::update_task_status(project, &task.id, config.status)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let path_env = prepare_path_env();
    let project_root = project.root().to_path_buf();
    let task_id = task.id.clone();

    // Use task's worktree_path if available, otherwise fall back to project_root
    let cwd = task
        .worktree_path
        .as_ref()
        .map_or(project_root, PathBuf::from);

    let mut child = spawn_claude_process(&cwd, &path_env, None)?;
    write_prompt_to_stdin(&mut child, &config.prompt)?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session_type = config.session_type.to_string();

    // Read stdout synchronously until we get the session_id or timeout
    let captured_session_id =
        wait_for_session_id(project, stdout, &task_id, &session_type, pid, timeout_secs);

    // Spawn background thread for stderr and process completion
    std::thread::spawn(move || {
        let stderr_handle = spawn_stderr_reader(stderr);
        log_stderr(&task_id, "Agent", stderr_handle);

        match child.wait() {
            Ok(status) => {
                eprintln!(
                    "Agent {} finished with exit code: {:?}",
                    task_id,
                    status.code()
                );
            }
            Err(e) => {
                eprintln!("Agent {task_id} error: {e}");
            }
        }
    });

    Ok(SpawnedAgent {
        task_id: task.id.clone(),
        process_id: pid,
        session_id: captured_session_id,
    })
}

/// Waits synchronously for `session_id` from stdout, with timeout
fn wait_for_session_id(
    project: &Project,
    stdout: Option<std::process::ChildStdout>,
    task_id: &str,
    session_type: &str,
    pid: u32,
    timeout_secs: u64,
) -> Option<String> {
    let stdout = stdout?;
    let reader = std::io::BufReader::new(stdout);
    let start_time = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in reader.lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let mut captured_session_id: Option<String> = None;

    loop {
        if start_time.elapsed() > timeout {
            eprintln!("Warning: Timeout waiting for session_id after {timeout_secs} seconds");
            break;
        }

        match rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(Ok(json_line)) => {
                if json_line.trim().is_empty() {
                    continue;
                }
                let parsed = parse_stream_event(&json_line);
                if let Some(sid) = parsed.session_id {
                    let _ =
                        tasks::add_task_session(project, task_id, session_type, &sid, Some(pid));
                    captured_session_id = Some(sid);
                    break;
                }
            }
            Ok(Err(e)) => {
                eprintln!("Error reading stdout: {e}");
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    // Spawn background thread to drain remaining stdout
    let task_id_clone = task_id.to_string();
    std::thread::spawn(move || {
        // Drain remaining lines from channel (session file captures everything)
        for _ in rx.iter().filter_map(Result::ok) {}
        eprintln!("Agent {task_id_clone} stdout processing completed");
    });

    captured_session_id
}

/// Resumes an interrupted Claude Code session
/// `session_key` specifies which session to resume (e.g., "plan", "work")
/// The `on_update` callback is called whenever there's new output (for real-time UI updates)
/// If the task has a `worktree_path`, the agent will be resumed in that directory.
pub fn resume_agent<F>(
    project: &Project,
    task: &Task,
    session_key: &str,
    continuation_prompt: Option<&str>,
    on_update: F,
) -> std::io::Result<SpawnedAgent>
where
    F: Fn(&str) + Send + 'static,
{
    let session_id = task
        .sessions
        .as_ref()
        .and_then(|s| s.get(session_key))
        .map(|info| info.session_id.clone())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("Task has no session '{session_key}' to resume"),
            )
        })?;

    let default_prompt = if session_key == "plan" {
        "The session was interrupted. Please continue creating the implementation plan where you left off."
    } else {
        "The session was interrupted. Please continue implementing the task where you left off."
    };
    let prompt = continuation_prompt.unwrap_or(default_prompt);

    let path_env = prepare_path_env();
    let project_root = project.root().to_path_buf();
    let task_id = task.id.clone();

    // Use task's worktree_path if available, otherwise fall back to project_root
    let cwd = task
        .worktree_path
        .as_ref()
        .map_or(project_root, PathBuf::from);

    let mut child = spawn_claude_process(&cwd, &path_env, Some(&session_id))?;
    write_prompt_to_stdin(&mut child, prompt)?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Record the PID immediately so orchestrator knows agent is running
    let _ = tasks::set_agent_pid(project, &task_id, Some(pid));

    let task_id_for_callback = task_id.clone();

    // Spawn background thread for stdout/stderr processing
    // Each thread gets its own Project instance (SQLite handles concurrent access)
    std::thread::spawn(move || {
        // Create a Project instance for this thread
        let thread_project = match Project::discover() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("Failed to discover project in agent thread: {e}");
                return;
            }
        };

        let stderr_handle = spawn_stderr_reader(stderr);

        if let Some(stdout) = stdout {
            let reader = std::io::BufReader::new(stdout);
            for json_line in reader.lines().map_while(std::result::Result::ok) {
                if json_line.trim().is_empty() {
                    continue;
                }
                let parsed = parse_stream_event(&json_line);
                if parsed.has_new_content {
                    on_update(&task_id_for_callback);
                }
            }
        }

        log_stderr(&task_id, "Resumed agent", stderr_handle);

        match child.wait() {
            Ok(status) => {
                eprintln!(
                    "Resumed agent {} finished with exit code: {:?}",
                    task_id,
                    status.code()
                );
                // Clear the PID now that agent is done
                let _ = tasks::set_agent_pid(&thread_project, &task_id, None);
                on_update(&task_id_for_callback);
            }
            Err(e) => {
                eprintln!("Resumed agent {task_id} error: {e}");
                // Clear the PID even on error
                let _ = tasks::set_agent_pid(&thread_project, &task_id, None);
                on_update(&task_id_for_callback);
            }
        }
    });

    Ok(SpawnedAgent {
        task_id: task.id.clone(),
        process_id: pid,
        session_id: None,
    })
}
