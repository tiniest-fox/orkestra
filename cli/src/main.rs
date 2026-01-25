//! Orkestra CLI - Debug tool for viewing workflow tasks.
//!
//! This CLI provides read-only access to the workflow system for debugging purposes.

use clap::{Parser, Subcommand};
use orkestra_core::{
    adapters::sqlite::DatabaseConnection,
    find_project_root,
    workflow::{
        load_workflow_for_project, Phase, SqliteWorkflowStore, Status, Task, WorkflowApi,
        WorkflowConfig,
    },
};

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
}

#[derive(Subcommand)]
enum TaskAction {
    /// List all tasks
    List {
        /// Filter by status (active, done, failed, blocked)
        #[arg(long)]
        status: Option<String>,
    },
    /// Show details for a specific task
    Show {
        /// Task ID
        id: String,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Task { action } => handle_task_action(action),
    }
}

fn handle_task_action(action: TaskAction) {
    // Initialize workflow API
    let api = match init_workflow_api() {
        Ok(api) => api,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };

    match action {
        TaskAction::List { status } => {
            let tasks = match api.list_tasks() {
                Ok(tasks) => tasks,
                Err(e) => {
                    eprintln!("Error loading tasks: {e}");
                    std::process::exit(1);
                }
            };

            // Filter by status if provided
            let tasks: Vec<_> = if let Some(ref filter) = status {
                tasks
                    .into_iter()
                    .filter(|t| matches_status_filter(t, filter))
                    .collect()
            } else {
                tasks
            };

            if tasks.is_empty() {
                println!("No tasks found.");
                return;
            }

            println!(
                "{:<12} {:<20} {:<15} {:<12} {}",
                "ID", "TITLE", "STATUS", "PHASE", "STAGE"
            );
            println!("{}", "-".repeat(80));

            for task in tasks {
                let title: String = task.title.chars().take(18).collect();
                let status_str = format_status(&task.status);
                let phase_str = format_phase(&task.phase);
                let stage = task.current_stage().unwrap_or("-");

                println!(
                    "{:<12} {:<20} {:<15} {:<12} {}",
                    task.id, title, status_str, phase_str, stage
                );
            }
        }

        TaskAction::Show { id } => {
            let task = match api.get_task(&id) {
                Ok(task) => task,
                Err(e) => {
                    eprintln!("Error: {e}");
                    std::process::exit(1);
                }
            };

            println!("Task: {}", task.id);
            println!("Title: {}", task.title);
            println!("Description: {}", task.description);
            println!("Status: {}", format_status(&task.status));
            println!("Phase: {}", format_phase(&task.phase));

            if let Some(stage) = task.current_stage() {
                println!("Current Stage: {}", stage);
            }

            if let Some(parent) = &task.parent_id {
                println!("Parent: {}", parent);
            }

            if let Some(pid) = task.agent_pid {
                println!("Agent PID: {}", pid);
            }

            if let Some(worktree) = &task.worktree_path {
                println!("Worktree: {}", worktree);
            }

            // Show artifacts
            let artifact_names: Vec<_> = task.artifacts.names().collect();
            if !artifact_names.is_empty() {
                println!("\nArtifacts:");
                for name in artifact_names {
                    if let Some(artifact) = task.artifacts.get(name) {
                        println!("  - {} (from stage: {})", name, artifact.stage);
                        // Show first 200 chars of content
                        let preview: String = artifact.content.chars().take(200).collect();
                        if !preview.is_empty() {
                            println!("    {}", preview.replace('\n', "\n    "));
                            if artifact.content.len() > 200 {
                                println!("    ... ({} more chars)", artifact.content.len() - 200);
                            }
                        }
                    }
                }
            }

            // Show pending questions
            if !task.pending_questions.is_empty() {
                println!("\nPending Questions:");
                for q in &task.pending_questions {
                    println!("  - [{}] {}", q.id, q.question);
                }
            }

            // Show iterations
            match api.get_iterations(&id) {
                Ok(iterations) if !iterations.is_empty() => {
                    println!("\nIterations:");
                    for iter in iterations {
                        let outcome_str = iter
                            .outcome
                            .as_ref()
                            .map(|o| format!("{:?}", o))
                            .unwrap_or_else(|| "in progress".to_string());
                        println!("  - {} (stage: {}, outcome: {})", iter.id, iter.stage, outcome_str);
                    }
                }
                _ => {}
            }

            println!("\nCreated: {}", task.created_at);
            println!("Updated: {}", task.updated_at);
            if let Some(completed) = &task.completed_at {
                println!("Completed: {}", completed);
            }
        }
    }
}

/// Initialize the workflow API.
fn init_workflow_api() -> Result<WorkflowApi, String> {
    let project_root =
        find_project_root().map_err(|e| format!("Failed to find project root: {e}"))?;

    let orkestra_dir = project_root.join(".orkestra");
    let db_path = orkestra_dir.join("workflow.db");

    if !db_path.exists() {
        return Err(format!(
            "Workflow database not found at {}. Is the Orkestra app running?",
            db_path.display()
        ));
    }

    // Load workflow config (or use default)
    let workflow_config = load_workflow_for_project(&project_root).unwrap_or_else(|e| {
        eprintln!("Warning: Failed to load workflow config: {e}, using default");
        WorkflowConfig::default()
    });

    // Open database connection
    let conn = DatabaseConnection::open(&db_path)
        .map_err(|e| format!("Failed to open workflow database: {e}"))?;

    // Create the store and API
    let store = SqliteWorkflowStore::new(conn.shared());

    Ok(WorkflowApi::new(workflow_config, Box::new(store)))
}

fn matches_status_filter(task: &Task, filter: &str) -> bool {
    match filter.to_lowercase().as_str() {
        "active" => task.status.is_active(),
        "done" => task.is_done(),
        "failed" => task.is_failed(),
        "blocked" => task.is_blocked(),
        _ => true,
    }
}

fn format_status(status: &Status) -> String {
    match status {
        Status::Active { stage } => format!("Active({})", stage),
        Status::Done => "Done".to_string(),
        Status::WaitingOnChildren => "Waiting".to_string(),
        Status::Failed { error } => {
            let msg = error.as_deref().unwrap_or("unknown");
            format!("Failed: {}", msg.chars().take(20).collect::<String>())
        }
        Status::Blocked { reason } => {
            let msg = reason.as_deref().unwrap_or("unknown");
            format!("Blocked: {}", msg.chars().take(20).collect::<String>())
        }
    }
}

fn format_phase(phase: &Phase) -> String {
    match phase {
        Phase::Idle => "Idle".to_string(),
        Phase::AgentWorking => "Working".to_string(),
        Phase::AwaitingReview => "Review".to_string(),
        Phase::Integrating => "Integrating".to_string(),
    }
}
