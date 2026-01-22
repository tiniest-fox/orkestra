use clap::{Parser, Subcommand};
use orkestra_core::{spawn_agent_sync, tasks, AgentType, TaskStatus};

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
    /// Mark a task as complete (moves to `ready_for_review`)
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
        /// New status (planning, `breaking_down`, `waiting_on_subtasks`, working, reviewing, done, failed, blocked)
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
    /// Approve a task's plan and move to breakdown or implementation
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
    /// Create a child task under a parent (parallel work, appears in Kanban)
    CreateTask {
        /// Parent task ID
        parent_id: String,
        /// Task title
        #[arg(short, long)]
        title: String,
        /// Task description
        #[arg(short, long, default_value = "")]
        description: String,
    },
    /// Create a subtask under a parent (checklist item, hidden from Kanban)
    CreateSubtask {
        /// Parent task ID
        parent_id: String,
        /// Subtask title
        #[arg(short, long)]
        title: String,
        /// Subtask description
        #[arg(short, long, default_value = "")]
        description: String,
    },
    /// Mark a subtask (checklist item) as complete
    CompleteSubtask {
        /// Subtask ID
        id: String,
    },
    /// Set the breakdown for a task (used by breakdown agent)
    SetBreakdown {
        /// Task ID
        id: String,
        /// The breakdown summary (markdown)
        #[arg(short, long)]
        breakdown: String,
    },
    /// Approve a task's breakdown and start working on subtasks
    ApproveBreakdown {
        /// Task ID
        id: String,
    },
    /// Request changes to a task's breakdown
    RequestBreakdownChanges {
        /// Task ID
        id: String,
        /// Feedback for the breakdown agent
        #[arg(short, long)]
        feedback: String,
    },
    /// Skip breakdown and go straight to working
    SkipBreakdown {
        /// Task ID
        id: String,
    },
    /// Show subtasks of a parent task
    Subtasks {
        /// Parent task ID
        parent_id: String,
    },
    /// Reviewer agent approves the implementation
    ApproveReview {
        /// Task ID
        id: String,
    },
    /// Reviewer agent rejects with feedback
    RejectReview {
        /// Task ID
        id: String,
        /// Feedback for the worker
        #[arg(short, long)]
        feedback: String,
    },
}

#[allow(clippy::too_many_lines)] // CLI dispatch naturally has many branches
fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Task { action } => {
            match action {
                TaskAction::List { status } => {
                    let all_tasks = tasks::load_tasks().unwrap_or_else(|e| {
                        eprintln!("Error loading tasks: {e}");
                        std::process::exit(1);
                    });

                    let filtered: Vec<_> = if let Some(status_filter) = status {
                        all_tasks
                            .into_iter()
                            .filter(|t| {
                                format!("{:?}", t.status).to_lowercase()
                                    == status_filter.to_lowercase()
                            })
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
                        eprintln!("Error loading tasks: {e}");
                        std::process::exit(1);
                    });

                    if let Some(task) = all_tasks.into_iter().find(|t| t.id == id) {
                        println!("ID: {}", task.id);
                        println!("Title: {}", task.title);
                        println!("Status: {:?}", task.status);
                        println!("Description: {}", task.description);
                        println!("Created: {}", task.created_at);
                        println!("Updated: {}", task.updated_at);
                        if let Some(summary) = task.summary {
                            println!("Summary: {summary}");
                        }
                        if let Some(error) = task.error {
                            println!("Error: {error}");
                        }
                    } else {
                        eprintln!("Task {id} not found");
                        std::process::exit(1);
                    }
                }
                TaskAction::Create { title, description } => {
                    match tasks::create_task(&title, &description) {
                        Ok(task) => {
                            println!("Created task: {}", task.id);
                        }
                        Err(e) => {
                            eprintln!("Error creating task: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                TaskAction::Complete { id, summary } => match tasks::complete_task(&id, &summary) {
                    Ok(task) => {
                        println!("Task {} marked as ready for review", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error completing task: {e}");
                        std::process::exit(1);
                    }
                },
                TaskAction::Fail { id, reason } => match tasks::fail_task(&id, &reason) {
                    Ok(task) => {
                        println!("Task {} marked as failed", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error failing task: {e}");
                        std::process::exit(1);
                    }
                },
                TaskAction::Block { id, reason } => match tasks::block_task(&id, &reason) {
                    Ok(task) => {
                        println!("Task {} marked as blocked", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error blocking task: {e}");
                        std::process::exit(1);
                    }
                },
                TaskAction::Status { id, status } => {
                    let task_status = match status.to_lowercase().as_str() {
                        "planning" => TaskStatus::Planning,
                        "breaking_down" => TaskStatus::BreakingDown,
                        "waiting_on_subtasks" => TaskStatus::WaitingOnSubtasks,
                        "working" => TaskStatus::Working,
                        "reviewing" => TaskStatus::Reviewing,
                        "done" => TaskStatus::Done,
                        "failed" => TaskStatus::Failed,
                        "blocked" => TaskStatus::Blocked,
                        _ => {
                            eprintln!("Invalid status: {status}. Valid values: planning, breaking_down, waiting_on_subtasks, working, reviewing, done, failed, blocked");
                            std::process::exit(1);
                        }
                    };

                    match tasks::update_task_status(&id, task_status) {
                        Ok(task) => {
                            println!("Task {} status updated to {:?}", task.id, task.status);
                        }
                        Err(e) => {
                            eprintln!("Error updating task status: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                TaskAction::SetPlan { id, plan } => match tasks::set_task_plan(&id, &plan) {
                    Ok(task) => {
                        println!("Plan set for task {}. Status: awaiting_approval", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error setting plan: {e}");
                        std::process::exit(1);
                    }
                },
                TaskAction::Approve { id } => {
                    match tasks::approve_task_plan(&id) {
                        Ok(task) => {
                            match task.status {
                                TaskStatus::BreakingDown => {
                                    println!(
                                        "Task {} plan approved. Status: breaking_down",
                                        task.id
                                    );
                                    // Spawn a breakdown agent
                                    match spawn_agent_sync(&task, AgentType::Breakdown, 30) {
                                        Ok(spawned) => {
                                            if let Some(sid) = &spawned.session_id {
                                                println!("Spawned breakdown agent (pid: {}, session: {})", spawned.process_id, sid);
                                            } else {
                                                println!("Spawned breakdown agent (pid: {}, session capture pending)", spawned.process_id);
                                            }
                                        }
                                        Err(e) => {
                                            eprintln!(
                                                "Warning: Failed to spawn breakdown agent: {e}"
                                            );
                                        }
                                    }
                                }
                                TaskStatus::Working => {
                                    println!("Task {} plan approved. Status: working (breakdown skipped)", task.id);
                                    // Spawn a worker agent
                                    match spawn_agent_sync(&task, AgentType::Worker, 30) {
                                        Ok(spawned) => {
                                            if let Some(sid) = &spawned.session_id {
                                                println!(
                                                    "Spawned worker agent (pid: {}, session: {})",
                                                    spawned.process_id, sid
                                                );
                                            } else {
                                                println!("Spawned worker agent (pid: {}, session capture pending)", spawned.process_id);
                                            }
                                        }
                                        Err(e) => {
                                            eprintln!(
                                                "Warning: Failed to spawn worker agent: {e}"
                                            );
                                        }
                                    }
                                }
                                _ => {
                                    println!(
                                        "Task {} plan approved. Status: {:?}",
                                        task.id, task.status
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Error approving plan: {e}");
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
                            eprintln!("Error requesting changes: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                TaskAction::CreateTask {
                    parent_id,
                    title,
                    description,
                } => match tasks::create_child_task(&parent_id, &title, &description) {
                    Ok(task) => {
                        println!("Created child task: {} (parent: {})", task.id, parent_id);
                    }
                    Err(e) => {
                        eprintln!("Error creating child task: {e}");
                        std::process::exit(1);
                    }
                },
                TaskAction::CreateSubtask {
                    parent_id,
                    title,
                    description,
                } => match tasks::create_subtask(&parent_id, &title, &description) {
                    Ok(task) => {
                        println!(
                            "Created subtask (checklist): {} (parent: {})",
                            task.id, parent_id
                        );
                    }
                    Err(e) => {
                        eprintln!("Error creating subtask: {e}");
                        std::process::exit(1);
                    }
                },
                TaskAction::CompleteSubtask { id } => match tasks::complete_subtask(&id) {
                    Ok(task) => {
                        println!("Subtask {} marked as complete", task.id);
                    }
                    Err(e) => {
                        eprintln!("Error completing subtask: {e}");
                        std::process::exit(1);
                    }
                },
                TaskAction::SetBreakdown { id, breakdown } => {
                    match tasks::set_breakdown(&id, &breakdown) {
                        Ok(task) => {
                            println!("Breakdown set for task {}. Ready for approval.", task.id);
                        }
                        Err(e) => {
                            eprintln!("Error setting breakdown: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                TaskAction::ApproveBreakdown { id } => {
                    match tasks::approve_breakdown(&id) {
                        Ok(task) => {
                            println!(
                                "Task {} breakdown approved. Status: waiting_on_subtasks",
                                task.id
                            );

                            // Spawn worker agents for child tasks only (not subtasks/checklist items)
                            match tasks::get_child_tasks(&id) {
                                Ok(child_tasks) => {
                                    for child in child_tasks {
                                        match spawn_agent_sync(&child, AgentType::Worker, 30) {
                                            Ok(spawned) => {
                                                if let Some(sid) = &spawned.session_id {
                                                    println!("Spawned worker for {} (pid: {}, session: {})", child.id, spawned.process_id, sid);
                                                } else {
                                                    println!("Spawned worker for {} (pid: {}, session capture pending)", child.id, spawned.process_id);
                                                }
                                            }
                                            Err(e) => {
                                                eprintln!(
                                                    "Warning: Failed to spawn worker for {}: {}",
                                                    child.id, e
                                                );
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Warning: Failed to get child tasks: {e}");
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Error approving breakdown: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                TaskAction::RequestBreakdownChanges { id, feedback } => {
                    match tasks::request_breakdown_changes(&id, &feedback) {
                        Ok(task) => {
                            println!(
                                "Breakdown changes requested for task {}. Status: breaking_down",
                                task.id
                            );
                        }
                        Err(e) => {
                            eprintln!("Error requesting breakdown changes: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                TaskAction::SkipBreakdown { id } => {
                    match tasks::skip_breakdown(&id) {
                        Ok(task) => {
                            println!("Task {} breakdown skipped. Status: working", task.id);

                            // Spawn a worker agent
                            match spawn_agent_sync(&task, AgentType::Worker, 30) {
                                Ok(spawned) => {
                                    if let Some(sid) = &spawned.session_id {
                                        println!(
                                            "Spawned worker agent (pid: {}, session: {})",
                                            spawned.process_id, sid
                                        );
                                    } else {
                                        println!("Spawned worker agent (pid: {}, session capture pending)", spawned.process_id);
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Warning: Failed to spawn worker agent: {e}");
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Error skipping breakdown: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                TaskAction::Subtasks { parent_id } => match tasks::get_children(&parent_id) {
                    Ok(children) => {
                        if children.is_empty() {
                            println!("No children found for {parent_id}.");
                            return;
                        }

                        println!("Children of {parent_id}:");
                        for task in children {
                            let kind = format!("{:?}", task.kind).to_lowercase();
                            println!(
                                "  {} [{}] ({}) {}",
                                task.id,
                                format!("{:?}", task.status).to_lowercase(),
                                kind,
                                task.title
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!("Error getting children: {e}");
                        std::process::exit(1);
                    }
                },
                TaskAction::ApproveReview { id } => {
                    match tasks::approve_automated_review(&id) {
                        Ok(task) => {
                            println!(
                                "Task {} review approved. Status: done",
                                task.id
                            );
                        }
                        Err(e) => {
                            eprintln!("Error approving review: {e}");
                            std::process::exit(1);
                        }
                    }
                }
                TaskAction::RejectReview { id, feedback } => {
                    match tasks::reject_automated_review(&id, &feedback) {
                        Ok(task) => {
                            println!(
                                "Task {} review rejected. Status: working (feedback provided)",
                                task.id
                            );
                        }
                        Err(e) => {
                            eprintln!("Error rejecting review: {e}");
                            std::process::exit(1);
                        }
                    }
                }
            }
        }
    }
}
