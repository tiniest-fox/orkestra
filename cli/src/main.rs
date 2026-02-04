//! Orkestra CLI - Debug tool for viewing workflow tasks.
//!
//! This CLI provides read-only access to the workflow system for debugging purposes.

use std::sync::Arc;

use clap::{Parser, Subcommand};
use orkestra_core::{
    adapters::sqlite::DatabaseConnection,
    find_project_root,
    utility::UtilityRunner,
    workflow::{
        load_workflow_for_project, Git2GitService, GitService, Phase, SqliteWorkflowStore,
        WorkflowApi, WorkflowConfig,
    },
};
use serde::Serialize;

#[derive(Parser)]
#[command(name = "ork")]
#[command(about = "CLI for Orkestra task management (debug)", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Task management commands
    Task {
        #[command(subcommand)]
        action: TaskAction,
    },
    /// Utility task commands
    Utility {
        #[command(subcommand)]
        action: UtilityAction,
    },
}

#[derive(Subcommand)]
enum TaskAction {
    /// List all tasks (JSON output)
    List {
        /// Include archived tasks
        #[arg(long)]
        archived: bool,
    },
    /// Show details for a specific task (JSON output)
    Show {
        /// Task ID
        id: String,
    },
    /// Create a new task
    Create {
        /// Task title
        #[arg(short, long)]
        title: String,
        /// Task description
        #[arg(short, long)]
        description: String,
        /// Base branch for the task worktree
        #[arg(short, long)]
        base_branch: Option<String>,
    },
    /// Approve the current stage artifact
    Approve {
        /// Task ID
        id: String,
    },
    /// Reject the current stage artifact with feedback
    Reject {
        /// Task ID
        id: String,
        /// Feedback explaining why the artifact was rejected
        #[arg(short, long)]
        feedback: String,
    },
    /// View artifact content (JSON output)
    Artifact {
        #[command(subcommand)]
        action: ArtifactAction,
    },
    /// View task logs (JSON output)
    Log {
        #[command(subcommand)]
        action: LogAction,
    },
    /// Reset task state
    Reset {
        /// Task ID
        id: String,
        /// Reset to a specific stage (removes all data from that stage forward)
        #[arg(long)]
        to_stage: Option<String>,
        /// Full reset (clear all iterations and artifacts)
        #[arg(long)]
        full: bool,
    },
    /// Edit task properties
    Edit {
        /// Task ID
        id: String,
        /// New title
        #[arg(long)]
        title: Option<String>,
        /// New description
        #[arg(long)]
        description: Option<String>,
    },
}

#[derive(Subcommand)]
enum ArtifactAction {
    /// Show artifact content with pagination
    Show {
        /// Task ID
        task_id: String,
        /// Artifact name (e.g., "plan", "summary")
        artifact_name: String,
        /// Starting line (0-indexed)
        #[arg(long, default_value = "0")]
        offset: usize,
        /// Number of lines to return
        #[arg(long, default_value = "100")]
        limit: usize,
    },
}

#[derive(Subcommand)]
enum LogAction {
    /// Show task log entries with pagination
    Show {
        /// Task ID
        task_id: String,
        /// Starting entry (0-indexed)
        #[arg(long, default_value = "0")]
        offset: usize,
        /// Number of entries to return
        #[arg(long, default_value = "50")]
        limit: usize,
    },
}

#[derive(Subcommand)]
enum UtilityAction {
    /// Run a utility task
    Run {
        /// Task name (e.g., "`generate_title`")
        name: String,
        /// Context as JSON (e.g., '{"description": "Fix the login bug"}')
        #[arg(short, long)]
        context: String,
    },
    /// List available utility tasks
    List,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Task { action } => handle_task_action(action),
        Commands::Utility { action } => handle_utility_action(action),
    }
}

fn handle_task_action(action: TaskAction) {
    let api = match init_workflow_api() {
        Ok(api) => api,
        Err(e) => {
            output_error(&e);
            std::process::exit(1);
        }
    };

    match action {
        TaskAction::List { archived } => handle_list_tasks(&api, archived),
        TaskAction::Show { id } => handle_show_task(&api, &id),
        TaskAction::Create {
            title,
            description,
            base_branch,
        } => handle_create_task(&api, &title, &description, base_branch.as_deref()),
        TaskAction::Approve { id } => handle_approve_task(&api, &id),
        TaskAction::Reject { id, feedback } => handle_reject_task(&api, &id, &feedback),
        TaskAction::Artifact { action } => handle_artifact_action(&api, action),
        TaskAction::Log { action } => handle_log_action(&api, action),
        TaskAction::Reset { id, to_stage, full } => {
            handle_reset_task(&api, &id, to_stage.as_deref(), full);
        }
        TaskAction::Edit {
            id,
            title,
            description,
        } => handle_edit_task(&api, &id, title.as_deref(), description.as_deref()),
    }
}

fn handle_create_task(
    api: &WorkflowApi,
    title: &str,
    description: &str,
    base_branch: Option<&str>,
) {
    let task = match api.create_task(title, description, base_branch) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error creating task: {e}");
            std::process::exit(1);
        }
    };

    println!("Created task: {}", task.id);
    println!("Title: {}", task.title);
    println!("Stage: {}", task.current_stage().unwrap_or("-"));
    if let Some(branch) = &task.branch_name {
        println!("Branch: {branch}");
    }
    if let Some(worktree) = &task.worktree_path {
        println!("Worktree: {worktree}");
    }
}

fn handle_approve_task(api: &WorkflowApi, id: &str) {
    let task = match api.approve(id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error approving task: {e}");
            std::process::exit(1);
        }
    };

    println!("Approved task: {}", task.id);
    if task.is_done() {
        println!("Status: Done");
    } else {
        println!("New stage: {}", task.current_stage().unwrap_or("-"));
    }
}

fn handle_reject_task(api: &WorkflowApi, id: &str, feedback: &str) {
    let task = match api.reject(id, feedback) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error rejecting task: {e}");
            std::process::exit(1);
        }
    };

    println!("Rejected task: {}", task.id);
    println!(
        "Stage: {} (new iteration)",
        task.current_stage().unwrap_or("-")
    );
}

fn handle_list_tasks(api: &WorkflowApi, include_archived: bool) {
    #[derive(Serialize)]
    struct TaskListEntry {
        id: String,
        title: String,
        description: String,
        stage: String,
        phase: String,
    }

    let tasks = if include_archived {
        match api.list_archived_tasks() {
            Ok(archived) => match api.list_tasks() {
                Ok(active) => {
                    let mut all = active;
                    all.extend(archived);
                    all
                }
                Err(e) => {
                    output_error(&format!("Error listing active tasks: {e}"));
                    std::process::exit(1);
                }
            },
            Err(e) => {
                output_error(&format!("Error listing archived tasks: {e}"));
                std::process::exit(1);
            }
        }
    } else {
        match api.list_tasks() {
            Ok(tasks) => tasks,
            Err(e) => {
                output_error(&format!("Error listing tasks: {e}"));
                std::process::exit(1);
            }
        }
    };

    let entries: Vec<TaskListEntry> = tasks
        .into_iter()
        .map(|t| {
            let description = if t.description.chars().count() > 200 {
                let end_idx = t
                    .description
                    .char_indices()
                    .nth(197)
                    .map_or(t.description.len(), |(i, _)| i);
                format!("{}...", &t.description[..end_idx])
            } else {
                t.description.clone()
            };
            let stage = t.current_stage().unwrap_or_default().to_string();
            let phase = format_phase(t.phase);
            TaskListEntry {
                id: t.id,
                title: t.title,
                description,
                stage,
                phase,
            }
        })
        .collect();

    output_json(&entries);
}

fn handle_show_task(api: &WorkflowApi, id: &str) {
    use std::collections::HashMap;

    #[derive(Serialize)]
    struct IterationSummary {
        stage: String,
        iteration_number: u32,
        started_at: String,
        ended_at: Option<String>,
        outcome: Option<String>,
    }

    #[derive(Serialize)]
    struct TaskShow {
        id: String,
        title: String,
        description: String,
        stage: String,
        phase: String,
        iterations: Vec<IterationSummary>,
        artifacts: HashMap<String, usize>,
        log_count: usize,
        parent_id: Option<String>,
        child_ids: Vec<String>,
    }

    let Ok(task) = api.get_task(id) else {
        output_error(&format!("Task not found: {id}"));
        std::process::exit(1);
    };

    // Get iterations
    let iterations = match api.get_iterations(&task.id) {
        Ok(iters) => iters
            .into_iter()
            .map(|i| IterationSummary {
                stage: i.stage,
                iteration_number: i.iteration_number,
                started_at: i.started_at,
                ended_at: i.ended_at,
                outcome: i.outcome.map(|o| format!("{o:?}")),
            })
            .collect(),
        Err(_) => vec![],
    };

    // Get artifacts with line counts
    let artifacts: HashMap<String, usize> = task
        .artifacts
        .names()
        .filter_map(|name| {
            task.artifacts.get(name).map(|artifact| {
                let line_count = artifact.content.lines().count();
                (name.to_string(), line_count)
            })
        })
        .collect();

    // Get log count
    let log_count = match api.get_task_logs(&task.id, None) {
        Ok(logs) => logs.len(),
        Err(_) => 0,
    };

    // Get child IDs
    let child_ids = match api.list_subtasks(&task.id) {
        Ok(children) => children.into_iter().map(|t| t.id).collect(),
        Err(_) => vec![],
    };

    let stage = task.current_stage().unwrap_or_default().to_string();
    let phase = format_phase(task.phase);

    let show = TaskShow {
        id: task.id,
        title: task.title,
        description: task.description,
        stage,
        phase,
        iterations,
        artifacts,
        log_count,
        parent_id: task.parent_id,
        child_ids,
    };

    output_json(&show);
}

fn handle_utility_action(action: UtilityAction) {
    match action {
        UtilityAction::Run { name, context } => {
            // Parse context JSON
            let context: serde_json::Value = match serde_json::from_str(&context) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("Error parsing context JSON: {e}");
                    std::process::exit(1);
                }
            };

            let runner = UtilityRunner::new();
            match runner.run(&name, &context) {
                Ok(output) => {
                    // Pretty print the output
                    let formatted = serde_json::to_string_pretty(&output)
                        .unwrap_or_else(|_| output.to_string());
                    println!("{formatted}");
                }
                Err(e) => {
                    eprintln!("Error running utility task: {e}");
                    std::process::exit(1);
                }
            }
        }
        UtilityAction::List => {
            println!("Available utility tasks:");
            println!("  - generate_title  Generate a concise title from a description");
            println!();
            println!("Usage:");
            println!(
                "  ork utility run generate_title -c '{{\"description\": \"Fix the login bug\"}}'"
            );
        }
    }
}

/// Initialize the workflow API.
fn init_workflow_api() -> Result<WorkflowApi, String> {
    let project_root =
        find_project_root().map_err(|e| format!("Failed to find project root: {e}"))?;

    let orkestra_dir = project_root.join(".orkestra");
    let db_path = orkestra_dir.join("orkestra.db");

    // Create .orkestra directory if it doesn't exist
    if !orkestra_dir.exists() {
        std::fs::create_dir_all(&orkestra_dir)
            .map_err(|e| format!("Failed to create .orkestra directory: {e}"))?;
    }

    // Load workflow config (or use default)
    let workflow_config = load_workflow_for_project(&project_root).unwrap_or_else(|e| {
        eprintln!("Warning: Failed to load workflow config: {e}, using default");
        WorkflowConfig::default()
    });

    // Open database connection (creates if doesn't exist)
    let conn = DatabaseConnection::open(&db_path)
        .map_err(|e| format!("Failed to open workflow database: {e}"))?;

    // Create the store
    let store = SqliteWorkflowStore::new(conn.shared());

    // Try to initialize git service
    let git_service: Option<Arc<dyn GitService>> = match Git2GitService::new(&project_root) {
        Ok(git) => Some(Arc::new(git)),
        Err(e) => {
            eprintln!("Warning: Git service unavailable: {e:?}");
            None
        }
    };

    // Create API with or without git
    let api = if let Some(git) = git_service {
        WorkflowApi::with_git(workflow_config, Arc::new(store), git)
    } else {
        WorkflowApi::new(workflow_config, Arc::new(store))
    };

    Ok(api)
}

fn format_phase(phase: Phase) -> String {
    match phase {
        Phase::AwaitingSetup => "Awaiting Setup".to_string(),
        Phase::SettingUp => "Setting Up".to_string(),
        Phase::Idle => "Idle".to_string(),
        Phase::AgentWorking => "Working".to_string(),
        Phase::AwaitingReview => "Review".to_string(),
        Phase::Integrating => "Integrating".to_string(),
    }
}

// ============================================================================
// JSON Output Helpers
// ============================================================================

/// Output a value as JSON to stdout.
fn output_json<T: Serialize>(value: &T) {
    let json = serde_json::to_string_pretty(value).expect("Failed to serialize to JSON");
    println!("{json}");
}

/// Output an error message as JSON to stderr.
fn output_error(message: &str) {
    #[derive(Serialize)]
    struct ErrorOutput {
        error: String,
    }
    let error = ErrorOutput {
        error: message.to_string(),
    };
    let json = serde_json::to_string(&error).expect("Failed to serialize error");
    eprintln!("{json}");
}

/// Output an error message with additional options as JSON to stderr.
fn output_error_with_options<T: Serialize>(message: &str, options: T) {
    #[derive(Serialize)]
    struct ErrorWithOptions<T> {
        error: String,
        available_options: T,
    }
    let error = ErrorWithOptions {
        error: message.to_string(),
        available_options: options,
    };
    let json = serde_json::to_string(&error).expect("Failed to serialize error");
    eprintln!("{json}");
}

// ============================================================================
// Stub Handlers (Placeholder JSON responses)
// ============================================================================

fn handle_artifact_action(api: &WorkflowApi, action: ArtifactAction) {
    match action {
        ArtifactAction::Show {
            task_id,
            artifact_name,
            offset,
            limit,
        } => {
            #[derive(Serialize)]
            struct ArtifactShow {
                content: String,
                total_lines: usize,
                offset: usize,
                limit: usize,
                has_more: bool,
            }

            // Get task to validate it exists
            let Ok(task) = api.get_task(&task_id) else {
                output_error(&format!("Task not found: {task_id}"));
                std::process::exit(1);
            };

            // Get artifact
            let Some(artifact) = task.artifacts.get(&artifact_name) else {
                use std::collections::HashMap;
                let available: HashMap<String, usize> = task
                    .artifacts
                    .names()
                    .filter_map(|name| {
                        task.artifacts.get(name).map(|a| {
                            let line_count = a.content.lines().count();
                            (name.to_string(), line_count)
                        })
                    })
                    .collect();
                output_error_with_options(
                    &format!("Artifact not found: {artifact_name}"),
                    available,
                );
                std::process::exit(1);
            };

            let lines: Vec<&str> = artifact.content.lines().collect();
            let total_lines = lines.len();
            let end = (offset + limit).min(total_lines);
            let content_lines = lines.get(offset..end).unwrap_or(&[]);
            let content = content_lines.join("\n");

            let response = ArtifactShow {
                content,
                total_lines,
                offset,
                limit,
                has_more: end < total_lines,
            };

            output_json(&response);
        }
    }
}

fn handle_log_action(api: &WorkflowApi, action: LogAction) {
    match action {
        LogAction::Show {
            task_id,
            offset,
            limit,
        } => {
            #[derive(Serialize)]
            struct LogShow {
                entries: Vec<serde_json::Value>,
                total_entries: usize,
                offset: usize,
                limit: usize,
                has_more: bool,
            }

            // Get task to validate it exists
            if api.get_task(&task_id).is_err() {
                output_error(&format!("Task not found: {task_id}"));
                std::process::exit(1);
            }

            // Get logs
            let all_logs = match api.get_task_logs(&task_id, None) {
                Ok(logs) => logs,
                Err(e) => {
                    output_error(&format!("Error getting logs: {e}"));
                    std::process::exit(1);
                }
            };

            let total_entries = all_logs.len();
            let end = (offset + limit).min(total_entries);
            let entries: Vec<serde_json::Value> = all_logs
                .into_iter()
                .skip(offset)
                .take(limit)
                .map(|entry| serde_json::to_value(entry).unwrap())
                .collect();

            let response = LogShow {
                entries,
                total_entries,
                offset,
                limit,
                has_more: end < total_entries,
            };

            output_json(&response);
        }
    }
}

fn handle_reset_task(api: &WorkflowApi, id: &str, to_stage: Option<&str>, full: bool) {
    #[derive(Serialize)]
    struct ResetResponse {
        status: String,
        message: String,
    }

    // Placeholder: Validate task exists
    if api.get_task(id).is_err() {
        output_error(&format!("Task not found: {id}"));
        std::process::exit(1);
    }

    let response = if full {
        ResetResponse {
            status: "placeholder".to_string(),
            message: format!("Full reset for task {id} not yet implemented"),
        }
    } else if let Some(stage) = to_stage {
        ResetResponse {
            status: "placeholder".to_string(),
            message: format!("Reset to stage '{stage}' for task {id} not yet implemented"),
        }
    } else {
        ResetResponse {
            status: "placeholder".to_string(),
            message: format!("Reset current stage for task {id} not yet implemented"),
        }
    };

    output_json(&response);
}

fn handle_edit_task(api: &WorkflowApi, id: &str, title: Option<&str>, description: Option<&str>) {
    #[derive(Serialize)]
    struct EditResponse {
        status: String,
        message: String,
    }

    // Placeholder: Validate task exists
    if api.get_task(id).is_err() {
        output_error(&format!("Task not found: {id}"));
        std::process::exit(1);
    }

    let mut parts = vec![];
    if title.is_some() {
        parts.push("title");
    }
    if description.is_some() {
        parts.push("description");
    }

    let response = EditResponse {
        status: "placeholder".to_string(),
        message: format!(
            "Edit {} for task {id} not yet implemented",
            parts.join(" and ")
        ),
    };

    output_json(&response);
}
