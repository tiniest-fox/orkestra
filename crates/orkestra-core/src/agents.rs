use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::fs;

use crate::project;
use crate::tasks::{Task, TaskStatus, update_task_status, update_task_logs, set_task_agent_pid};

/// Builds the prompt to send to Claude Code for a given task
pub fn build_agent_prompt(task: &Task, agent_definition: &str) -> String {
    format!(
        r#"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}

---

Remember: When you are done, you MUST run one of these commands:
- `ork task complete {task_id} --summary "what you did"` - if successful
- `ork task fail {task_id} --reason "why"` - if you cannot complete it
- `ork task block {task_id} --reason "what you need"` - if you need clarification
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
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
    let dev_path = std::env::current_dir()
        .ok()?
        .join("target/debug/ork");
    if dev_path.exists() {
        return Some(dev_path);
    }

    None
}

/// Loads the agent definition from the agents directory
pub fn load_agent_definition(agent_type: &str) -> std::io::Result<String> {
    // Try project root first
    if let Ok(project_root) = project::find_project_root() {
        let local_path = project_root.join("agents").join(format!("{}.md", agent_type));
        if local_path.exists() {
            return fs::read_to_string(local_path);
        }
    }

    // Try current directory
    let cwd = std::env::current_dir()?;
    let local_path = cwd.join("agents").join(format!("{}.md", agent_type));
    if local_path.exists() {
        return fs::read_to_string(local_path);
    }

    // Fall back to home directory
    if let Some(home) = dirs::home_dir() {
        let home_path = home.join(".orkestra/agents").join(format!("{}.md", agent_type));
        if home_path.exists() {
            return fs::read_to_string(home_path);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("Agent definition not found: {} (searched project root, cwd, and ~/.orkestra/agents/)", agent_type),
    ))
}

/// Result of spawning an agent
#[derive(Debug)]
pub struct SpawnedAgent {
    pub task_id: String,
    pub process_id: u32,
}

/// Spawns a Claude Code agent to work on a task
pub fn spawn_agent(task: &Task) -> std::io::Result<SpawnedAgent> {
    // Load the worker agent definition
    let agent_def = load_agent_definition("worker")?;

    // Build the prompt
    let prompt = build_agent_prompt(task, &agent_def);

    // Update task status to in_progress
    update_task_status(&task.id, TaskStatus::InProgress)?;

    // Find the CLI path and add its directory to PATH for the subprocess
    let cli_path = find_cli_path();
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(ref cli) = cli_path {
        if let Some(parent) = cli.parent() {
            path_env = format!("{}:{}", parent.display(), path_env);
        }
    }

    // Get the project root to run Claude in the right directory
    let project_root = project::find_project_root()?;

    let task_id = task.id.clone();

    // Spawn claude with the prompt piped via stdin
    use std::io::Write as IoWrite;
    let mut child = Command::new("claude")
        .args([
            "--print",
            "--dangerously-skip-permissions",
        ])
        .env("PATH", path_env)
        .current_dir(&project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Write the prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
        // stdin is dropped here, closing the pipe
    }

    let pid = child.id();

    // Store the PID in the task
    let _ = set_task_agent_pid(&task_id, pid);

    // Spawn a thread to capture output and store in task
    std::thread::spawn(move || {
        let output = child.wait_with_output();
        match output {
            Ok(output) => {
                let log_content = String::from_utf8_lossy(&output.stdout).to_string();
                let _ = update_task_logs(&task_id, &log_content);
                eprintln!("Agent {} finished with exit code: {:?}", task_id, output.status.code());
            }
            Err(e) => {
                let _ = update_task_logs(&task_id, &format!("Error: {}", e));
                eprintln!("Agent {} error: {}", task_id, e);
            }
        }
    });

    Ok(SpawnedAgent {
        task_id: task.id.clone(),
        process_id: pid,
    })
}
