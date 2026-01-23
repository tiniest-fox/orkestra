use std::fs;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::domain::{Task, TaskStatus};
use crate::project;
use crate::prompts::{
    build_breakdown_prompt, build_planner_prompt, build_reviewer_prompt,
    build_title_generator_prompt, build_worker_prompt, render_resume_breakdown,
    render_resume_planner, render_resume_reviewer, render_resume_worker, ResumeBreakdownContext,
    ResumePlannerContext, ResumeReviewerContext, ResumeWorkerContext,
};
use crate::services::Project;
use crate::tasks;

/// Agent types that can be spawned
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AgentType {
    Planner,
    Breakdown,
    Worker,
    Reviewer,
    TitleGenerator,
}

/// RAII guard that ensures a spawned process is killed when dropped.
/// This provides defense-in-depth: if code panics or takes an unexpected path,
/// the process will still be cleaned up.
///
/// Call `disarm()` when the process exits normally to prevent killing on drop.
pub struct ProcessGuard {
    pid: u32,
    disarmed: AtomicBool,
}

impl ProcessGuard {
    /// Create a new process guard for the given PID.
    pub fn new(pid: u32) -> Self {
        Self {
            pid,
            disarmed: AtomicBool::new(false),
        }
    }

    /// Disarm the guard to prevent killing the process on drop.
    /// Call this when the process exits normally.
    pub fn disarm(&self) {
        self.disarmed.store(true, Ordering::Relaxed);
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        if !self.disarmed.load(Ordering::Relaxed) {
            eprintln!(
                "[ProcessGuard] Killing orphaned process {} on drop",
                self.pid
            );
            let _ = kill_agent(self.pid);
        }
    }
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
    // TitleGenerator uses a separate flow (generate_title_sync), not the normal spawn infrastructure
    if agent_type == AgentType::TitleGenerator {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "TitleGenerator should use generate_title_sync() instead of spawn_agent()",
        ));
    }

    let agent_name = match agent_type {
        AgentType::Planner => "planner",
        AgentType::Breakdown => "breakdown",
        AgentType::Worker => "worker",
        AgentType::Reviewer => "reviewer",
        AgentType::TitleGenerator => unreachable!(), // handled above
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
        AgentType::TitleGenerator => unreachable!(), // handled above
    };

    let status = match agent_type {
        AgentType::Planner => TaskStatus::Planning,
        AgentType::Breakdown => TaskStatus::BreakingDown,
        AgentType::Worker => TaskStatus::Working,
        AgentType::Reviewer => TaskStatus::Reviewing,
        AgentType::TitleGenerator => unreachable!(), // handled above
    };

    let session_type = match agent_type {
        AgentType::Planner => "plan",
        AgentType::Breakdown => "breakdown",
        AgentType::Worker => "work",
        AgentType::Reviewer => "review",
        AgentType::TitleGenerator => unreachable!(), // handled above
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
    .stderr(Stdio::piped());

    // Create new process group so we can kill all descendants (cargo, rustc, etc.)
    // when the agent is terminated. Without this, child processes become orphans.
    #[cfg(unix)]
    cmd.process_group(0);

    cmd.spawn()
}

/// Recursively finds all descendant PIDs of a given process.
/// Uses pgrep -P to find children at each level.
#[cfg(unix)]
fn get_descendant_pids(pid: u32) -> Vec<u32> {
    let mut descendants = Vec::new();
    let mut to_check = vec![pid];

    while let Some(parent_pid) = to_check.pop() {
        // Use pgrep -P to find direct children
        if let Ok(output) = Command::new("pgrep").args(["-P", &parent_pid.to_string()]).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Ok(child_pid) = line.trim().parse::<u32>() {
                        descendants.push(child_pid);
                        to_check.push(child_pid);
                    }
                }
            }
        }
    }

    descendants
}

/// Kills an agent and all its descendant processes.
/// This ensures that when an agent is terminated, all spawned processes
/// (cargo, rustc, shells, etc.) are also killed, preventing orphaned processes.
///
/// Strategy:
/// 1. First collect all descendant PIDs (children create their own process groups)
/// 2. Kill the main process group (catches direct children in same group)
/// 3. Kill any remaining descendants that were in different process groups
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap)]
pub fn kill_agent(pid: u32) -> std::io::Result<()> {
    // Collect all descendants BEFORE killing (they may reparent to init otherwise)
    let descendants = get_descendant_pids(pid);

    // The PID is the process group ID since we spawn with process_group(0)
    let pgid = pid as i32;

    // First try SIGTERM for graceful shutdown of the main process group
    let result = unsafe { libc::kill(-pgid, libc::SIGTERM) };

    if result != 0 {
        let err = std::io::Error::last_os_error();
        // ESRCH means process doesn't exist - that's fine
        if err.raw_os_error() != Some(libc::ESRCH) {
            // If SIGTERM failed for another reason, try SIGKILL
            unsafe { libc::kill(-pgid, libc::SIGKILL) };
        }
    }

    // Now kill any descendants that were in different process groups
    // (e.g., shells spawned by Claude that created their own process groups)
    for desc_pid in descendants {
        let desc_pgid = desc_pid as i32;
        // Try to kill the descendant's process group first
        let result = unsafe { libc::kill(-desc_pgid, libc::SIGTERM) };
        if result != 0 {
            // If process group kill failed, try killing just the process
            unsafe { libc::kill(desc_pgid, libc::SIGTERM) };
        }
    }

    Ok(())
}

#[cfg(not(unix))]
pub fn kill_agent(pid: u32) -> std::io::Result<()> {
    // On Windows, use taskkill with /T to kill the tree
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()?;
    Ok(())
}

/// Checks if a process with the given PID is still running.
/// Uses kill(pid, 0) on Unix to check without sending a signal.
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap)]
pub fn is_process_running(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(not(unix))]
pub fn is_process_running(_pid: u32) -> bool {
    // On Windows, we can't easily check without more complex logic
    // For now, assume not running (conservative - may cause unnecessary cleanup)
    false
}

/// Kills all agents that have tracked PIDs in the task database.
/// Useful for cleanup on shutdown or when recovering from stuck state.
pub fn kill_all_agents(project: &Project) -> std::io::Result<()> {
    let tasks = tasks::load_tasks(project)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    for task in tasks {
        if let Some(pid) = task.agent_pid {
            let _ = kill_agent(pid);
            // Clear the PID since we killed it
            let _ = tasks::set_agent_pid(project, &task.id, None);
        }
    }

    Ok(())
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

    // Create process guard for RAII cleanup if thread panics or takes unexpected path
    let guard = ProcessGuard::new(pid);

    // Record the PID immediately so orchestrator knows agent is running
    // Note: Background thread will use its own Project instance for subsequent updates
    let _ = tasks::set_agent_pid(project, &task_id, Some(pid));

    let task_id_for_callback = task_id.clone();

    // Spawn background thread for stdout/stderr processing
    // Each thread gets its own Project instance (SQLite handles concurrent access)
    std::thread::spawn(move || {
        // Guard is moved into thread - will kill process on drop unless disarmed
        let _guard = guard;

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
                // Process exited normally - disarm the guard
                _guard.disarm();
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
                // Process wait failed - disarm since we don't know state
                _guard.disarm();
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

    // Create process guard for RAII cleanup if thread panics or takes unexpected path
    let guard = ProcessGuard::new(pid);

    // Read stdout synchronously until we get the session_id or timeout
    let captured_session_id =
        wait_for_session_id(project, stdout, &task_id, &session_type, pid, timeout_secs);

    // Spawn background thread for stderr and process completion
    std::thread::spawn(move || {
        // Guard is moved into thread - will kill process on drop unless disarmed
        let _guard = guard;

        let stderr_handle = spawn_stderr_reader(stderr);
        log_stderr(&task_id, "Agent", stderr_handle);

        match child.wait() {
            Ok(status) => {
                // Process exited normally - disarm the guard
                _guard.disarm();
                eprintln!(
                    "Agent {} finished with exit code: {:?}",
                    task_id,
                    status.code()
                );
            }
            Err(e) => {
                // Process wait failed - disarm since we don't know state
                _guard.disarm();
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

    // Build the resumption prompt using the appropriate template for this session type
    // The continuation_prompt parameter is treated as feedback (if any) for the agent
    let prompt = match session_key {
        "plan" => render_resume_planner(&ResumePlannerContext {
            task_id: &task.id,
            plan_feedback: continuation_prompt,
        }),
        "work" => render_resume_worker(&ResumeWorkerContext {
            task_id: &task.id,
            review_feedback: continuation_prompt,
        }),
        s if s == "review" || s.starts_with("review_") => {
            render_resume_reviewer(&ResumeReviewerContext { task_id: &task.id })
        }
        "breakdown" => render_resume_breakdown(&ResumeBreakdownContext {
            task_id: &task.id,
            breakdown_feedback: continuation_prompt,
        }),
        _ => render_resume_worker(&ResumeWorkerContext {
            task_id: &task.id,
            review_feedback: continuation_prompt,
        }),
    };

    let path_env = prepare_path_env();
    let project_root = project.root().to_path_buf();
    let task_id = task.id.clone();

    // Use task's worktree_path if available, otherwise fall back to project_root
    let cwd = task
        .worktree_path
        .as_ref()
        .map_or(project_root, PathBuf::from);

    let mut child = spawn_claude_process(&cwd, &path_env, Some(&session_id))?;
    write_prompt_to_stdin(&mut child, &prompt)?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Create process guard for RAII cleanup if thread panics or takes unexpected path
    let guard = ProcessGuard::new(pid);

    // Record the PID immediately so orchestrator knows agent is running
    let _ = tasks::set_agent_pid(project, &task_id, Some(pid));

    let task_id_for_callback = task_id.clone();

    // Spawn background thread for stdout/stderr processing
    // Each thread gets its own Project instance (SQLite handles concurrent access)
    std::thread::spawn(move || {
        // Guard is moved into thread - will kill process on drop unless disarmed
        let _guard = guard;

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
                // Process exited normally - disarm the guard
                _guard.disarm();
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
                // Process wait failed - disarm since we don't know state
                _guard.disarm();
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

// =============================================================================
// Title Generation
// =============================================================================

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
