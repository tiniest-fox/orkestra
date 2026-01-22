use clap::{Parser, Subcommand};
use orkestra_core::{tasks, AgentType, TaskStatus, spawn_agent_sync};

#[derive(Parser)]
#[command(name = "orkestra")]
#[command(about = "CLI for Orkestra task management", long_about = None)]
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
        /// Filter by status
        #[arg(short, long)]
        status: Option<String>,
    },
    /// Show a specific task
    Show {
        /// Task ID (e.g., TASK-001)
        id: String,
    },
    /// Create a new task
    Create {
        /// Task title
        #[arg(short, long)]
        title: String,
        /// Task description
        #[arg(short, long, default_value = "")]
        description: String,
    },
    /// Mark a task as complete (moves to ready_for_review)
    Complete {
        /// Task ID
        id: String,
        /// Summary of what was done
        #[arg(short, long)]
        summary: String,
    },
    /// Mark a task as failed
    Fail {
        /// Task ID
        id: String,
        /// Reason for failure
        #[arg(short, long)]
        reason: String,
    },
    /// Mark a task as blocked
    Block {
        /// Task ID
        id: String,
        /// Blocker description
        #[arg(short, long)]
        reason: String,
    },
    /// Update task status
    Status {
        /// Task ID
        id: String,
        /// New status (pending, planning, awaiting_approval, in_progress, ready_for_review, done, failed, blocked)
        status: String,
    },
    /// Set the implementation plan for a task (used by planner agent)
    SetPlan {
        /// Task ID
        id: String,
        /// The implementation plan (markdown)
        #[arg(short, long)]
        plan: String,
    },
    /// Approve a task's plan and move to implementation
    Approve {
        /// Task ID
        id: String,
    },
    /// Request changes to a task's plan
    RequestChanges {
        /// Task ID
        id: String,
        /// Feedback for the planner
        #[arg(short, long)]
        feedback: String,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Task { action } => match action {
            TaskAction::List { status } => {
                let all_tasks = tasks::load_tasks().unwrap_or_else(|e| {
                    eprintln!("Error loading tasks: {}", e);
                    std::process::exit(1);
                });

                let filtered: Vec<_> = if let Some(status_filter) = status {
                    all_tasks
                        .into_iter()
                        .filter(|t| format!("{:?}", t.status).to_lowercase() == status_filter.to_lowercase())
                        .collect()
                } else {
                    all_tasks
                };

                if filtered.is_empty() {
                    println!("No tasks found.");
                    return;
                }

                for task in filtered {
                    println!(
                        "{} [{}] {}",
                        task.id,
                        format!("{:?}", task.status).to_lowercase(),
                        task.title
                    );
                }
            }
            TaskAction::Show { id } => {
                let all_tasks = tasks::load_tasks().unwrap_or_else(|e| {
                    eprintln!("Error loading tasks: {}", e);
                    std::process::exit(1);
                });

                match all_tasks.into_iter().find(|t| t.id == id) {
                    Some(task) => {
                        println!("ID: {}", task.id);
                        println!("Title: {}", task.title);
                        println!("Status: {:?}", task.status);
                        println!("Description: {}", task.description);
                        println!("Created: {}", task.created_at);
                        println!("Updated: {}", task.updated_at);
                        if let Some(summary) = task.summary {
                            println!("Summary: {}", summary);
                        }
                        if let Some(error) = task.error {
                            println!("Error: {}", error);
                        }
                    }
                    None => {
                        eprintln!("Task {} not found", id);
                        std::process::exit(1);
                    }
                }
            }
            TaskAction::Create { title, description } => {
                match tasks::create_task(&title, &description) {
                    Ok(task) => {
                        println!("Created task: {}", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error creating task: {}", e);
                        std::process::exit(1);
                    }
                }
            }
            TaskAction::Complete { id, summary } => {
                match tasks::complete_task(&id, &summary) {
                    Ok(task) => {
                        println!("Task {} marked as ready for review", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error completing task: {}", e);
                        std::process::exit(1);
                    }
                }
            }
            TaskAction::Fail { id, reason } => {
                match tasks::fail_task(&id, &reason) {
                    Ok(task) => {
                        println!("Task {} marked as failed", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error failing task: {}", e);
                        std::process::exit(1);
                    }
                }
            }
            TaskAction::Block { id, reason } => {
                match tasks::block_task(&id, &reason) {
                    Ok(task) => {
                        println!("Task {} marked as blocked", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error blocking task: {}", e);
                        std::process::exit(1);
                    }
                }
            }
            TaskAction::Status { id, status } => {
                let task_status = match status.to_lowercase().as_str() {
                    "pending" => TaskStatus::Pending,
                    "planning" => TaskStatus::Planning,
                    "awaiting_approval" => TaskStatus::AwaitingApproval,
                    "in_progress" => TaskStatus::InProgress,
                    "ready_for_review" => TaskStatus::ReadyForReview,
                    "done" => TaskStatus::Done,
                    "failed" => TaskStatus::Failed,
                    "blocked" => TaskStatus::Blocked,
                    _ => {
                        eprintln!("Invalid status: {}. Valid values: pending, planning, awaiting_approval, in_progress, ready_for_review, done, failed, blocked", status);
                        std::process::exit(1);
                    }
                };

                match tasks::update_task_status(&id, task_status) {
                    Ok(task) => {
                        println!("Task {} status updated to {:?}", task.id, task.status);
                    }
                    Err(e) => {
                        eprintln!("Error updating task status: {}", e);
                        std::process::exit(1);
                    }
                }
            }
            TaskAction::SetPlan { id, plan } => {
                match tasks::set_task_plan(&id, &plan) {
                    Ok(task) => {
                        println!("Plan set for task {}. Status: awaiting_approval", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error setting plan: {}", e);
                        std::process::exit(1);
                    }
                }
            }
            TaskAction::Approve { id } => {
                match tasks::approve_task_plan(&id) {
                    Ok(task) => {
                        println!("Task {} plan approved. Status: in_progress", task.id);

                        // Spawn a worker agent to implement the approved plan
                        // Use the synchronous version to ensure session_id is captured
                        // before this CLI process exits (important for auto-approve mode)
                        match spawn_agent_sync(&task, AgentType::Worker, 30) {
                            Ok(spawned) => {
                                if let Some(sid) = &spawned.session_id {
                                    println!("Spawned worker agent (pid: {}, session: {})", spawned.process_id, sid);
                                } else {
                                    println!("Spawned worker agent (pid: {}, session capture pending)", spawned.process_id);
                                }
                            }
                            Err(e) => {
                                eprintln!("Warning: Failed to spawn worker agent: {}", e);
                                // Don't exit - the task status was already updated
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Error approving plan: {}", e);
                        std::process::exit(1);
                    }
                }
            }
            TaskAction::RequestChanges { id, feedback } => {
                match tasks::request_plan_changes(&id, &feedback) {
                    Ok(task) => {
                        println!("Changes requested for task {}. Status: planning", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error requesting changes: {}", e);
                        std::process::exit(1);
                    }
                }
            }
        },
    }
}
