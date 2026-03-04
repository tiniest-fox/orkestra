//! Orkestra CLI - Debug tool for viewing workflow tasks.
//!
//! This CLI provides read-only access to the workflow system for debugging purposes.

use std::sync::{Arc, Mutex};

use std::fmt::Write as _;

use clap::{Parser, Subcommand};
use orkestra_cli::{get_git_state, GitState};
use orkestra_core::{
    adapters::sqlite::DatabaseConnection,
    find_project_root,
    utility::UtilityRunner,
    workflow::{
        adapters::GhPrService,
        create_pr_sync,
        domain::{IterationTrigger, LogEntry, PrCheckData},
        load_workflow_for_project,
        runtime::Outcome,
        Git2GitService, GitService, Iteration, SqliteWorkflowStore, StageSession, Task, TaskState,
        TaskView, WorkflowApi,
    },
};
use orkestra_networking::generate_pairing_code;

#[derive(Clone, clap::ValueEnum)]
enum StatusFilter {
    Active,
    Done,
    Failed,
    Blocked,
    Archived,
}

#[derive(Parser)]
#[command(name = "ork")]
#[command(about = "CLI for Orkestra task management (debug)", long_about = None)]
struct Cli {
    /// Output human-readable formatting instead of JSON
    #[arg(long, global = true)]
    pretty: bool,

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
    /// View agent and script logs
    Logs {
        /// Task ID
        task_id: String,
        /// Stage name (required for viewing logs)
        #[arg(long)]
        stage: Option<String>,
        /// Filter by log entry type (text, error, `tool_use`, `tool_result`, `script_output`, etc.)
        #[arg(long, name = "type")]
        type_filter: Option<String>,
        /// Maximum number of log entries to return (default: 100)
        #[arg(long, default_value = "100")]
        limit: usize,
        /// Number of log entries to skip
        #[arg(long, default_value = "0")]
        offset: usize,
    },
    /// Utility task commands
    Utility {
        #[command(subcommand)]
        action: UtilityAction,
    },
    /// Generate a pairing code for daemon access
    Pair,
}

#[derive(Subcommand)]
enum TaskAction {
    /// List all tasks
    List {
        /// Filter by status (active, done, failed, blocked)
        #[arg(long)]
        status: Option<StatusFilter>,
        /// List subtasks of a parent task
        #[arg(long)]
        parent: Option<String>,
        /// List tasks that depend on this task
        #[arg(long)]
        depends_on: Option<String>,
    },
    /// Show details for a specific task
    Show {
        /// Task ID
        id: String,
        /// Show iteration history (stages, outcomes, feedback)
        #[arg(long)]
        iterations: bool,
        /// Show stage session history (spawning, PIDs, state)
        #[arg(long)]
        sessions: bool,
        /// Show git state (branch, HEAD, dirty status)
        #[arg(long)]
        git: bool,
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
        /// Assign task to a named flow (e.g., "quick", "hotfix")
        #[arg(long)]
        flow: Option<String>,
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
    /// Merge a Done task's branch into its base branch
    Merge {
        /// Task ID to merge
        id: String,
    },
    /// Create a pull request for a Done task's branch
    OpenPr {
        /// Task ID to create PR for
        id: String,
    },
    /// Retry PR creation (recover from Failed back to Done)
    RetryPr {
        /// Task ID to retry
        id: String,
    },
    /// Push updated changes to an existing open PR
    PushPr {
        /// Task ID to push PR changes for
        id: String,
    },
    /// Pull remote changes into the local worktree for an existing open PR
    PullPr {
        /// Task ID to pull PR changes for
        id: String,
    },
    /// Retry a failed or blocked task (recovers to Idle phase)
    Retry {
        /// Task ID
        id: String,
        /// Optional instructions for the agent
        #[arg(short, long)]
        instructions: Option<String>,
    },
    /// Address failing CI checks and/or request changes
    AddressFeedback {
        /// Task ID
        id: String,
        /// Optional guidance for the agent
        #[arg(long)]
        guidance: Option<String>,
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
        Commands::Task { action } => handle_task_action(action, cli.pretty),
        Commands::Logs {
            task_id,
            stage,
            type_filter,
            limit,
            offset,
        } => handle_logs(
            &task_id,
            stage,
            type_filter.as_deref(),
            limit,
            offset,
            cli.pretty,
        ),
        Commands::Utility { action } => handle_utility_action(action),
        Commands::Pair => {
            if let Err(e) = handle_pair() {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
    }
}

fn output_json<T: serde::Serialize>(value: &T) {
    let json = serde_json::to_string(value).expect("JSON serialization failed");
    println!("{json}");
}

fn handle_pair() -> Result<(), String> {
    let project_root =
        find_project_root().map_err(|e| format!("Failed to find project root: {e}"))?;
    let db_path = project_root.join(".orkestra/.database/orkestra.db");
    let conn = DatabaseConnection::open(&db_path)
        .map_err(|e| format!("Failed to open workflow database: {e}"))?;
    let code = generate_pairing_code::execute(&conn.shared())
        .map_err(|e| format!("Failed to generate pairing code: {e}"))?;
    println!("{code}");
    Ok(())
}

fn handle_task_action(action: TaskAction, pretty: bool) {
    let api = match init_workflow_api() {
        Ok(api) => api,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };

    // OpenPr needs Arc<Mutex<WorkflowApi>> for create_pr_sync — handle it before
    // borrowing api for the other branches. PushPr and other PR commands take
    // &WorkflowApi directly and stay in the match below.
    if let TaskAction::OpenPr { id } = &action {
        handle_open_pr_task(Arc::new(Mutex::new(api)), id, pretty);
        return;
    }

    match action {
        TaskAction::List {
            status,
            parent,
            depends_on,
        } => handle_list_tasks(&api, status.as_ref(), parent, depends_on, pretty),
        TaskAction::Show {
            id,
            iterations,
            sessions,
            git,
        } => handle_show_task(&api, &id, iterations, sessions, git, pretty),
        TaskAction::Create {
            title,
            description,
            base_branch,
            flow,
        } => handle_create_task(
            &api,
            &title,
            &description,
            base_branch.as_deref(),
            flow.as_deref(),
            pretty,
        ),
        TaskAction::Approve { id } => handle_approve_task(&api, &id, pretty),
        TaskAction::Reject { id, feedback } => handle_reject_task(&api, &id, &feedback, pretty),
        TaskAction::Merge { id } => handle_merge_task(&api, &id, pretty),
        TaskAction::OpenPr { .. } => unreachable!("handled above"),
        TaskAction::RetryPr { id } => handle_retry_pr_task(&api, &id, pretty),
        TaskAction::PushPr { id } => handle_push_pr_task(&api, &id, pretty),
        TaskAction::PullPr { id } => handle_pull_pr_task(&api, &id, pretty),
        TaskAction::Retry { id, instructions } => {
            handle_retry_task(&api, &id, instructions.as_deref(), pretty);
        }
        TaskAction::AddressFeedback { id, guidance } => {
            handle_address_feedback(&api, &id, guidance.as_deref(), pretty);
        }
    }
}

fn handle_logs(
    task_id: &str,
    stage: Option<String>,
    type_filter: Option<&str>,
    limit: usize,
    offset: usize,
    pretty: bool,
) {
    let api = match init_workflow_api() {
        Ok(api) => api,
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };

    // If no --stage provided, list available stages and exit with error
    let Some(stage_name) = stage else {
        let stages = match api.get_stages_with_logs(task_id) {
            Ok(stages) => stages,
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        };
        if stages.is_empty() {
            eprintln!("No stages with logs found for task {task_id}");
        } else {
            eprintln!("Error: --stage is required. Available stages with logs:");
            for s in &stages {
                eprintln!("  {s}");
            }
        }
        std::process::exit(1);
    };

    // Get logs for the specified stage
    let mut logs = match api.get_task_logs(task_id, Some(&stage_name), None) {
        Ok(logs) => logs,
        Err(e) => {
            eprintln!("Error getting logs: {e}");
            std::process::exit(1);
        }
    };

    // Apply type filter if specified
    if let Some(type_name) = type_filter {
        let pre_filter_count = logs.len();
        logs.retain(|entry| entry.type_name() == type_name);
        if logs.is_empty() && pre_filter_count > 0 {
            eprintln!(
                "Warning: --type \"{type_name}\" matched no entries. Valid types: text, user_message, tool_use, tool_result, subagent_tool_use, subagent_tool_result, process_exit, error, script_start, script_output, script_exit"
            );
        }
    }

    // Apply pagination (offset then limit)
    let total = logs.len();
    let logs: Vec<_> = logs.into_iter().skip(offset).take(limit).collect();

    // Output
    if pretty {
        println!(
            "Logs for task {} stage {} ({} of {} entries)",
            task_id,
            stage_name,
            logs.len(),
            total
        );
        println!("{}", "-".repeat(60));
        for entry in &logs {
            print_log_entry_pretty(entry);
        }
    } else {
        // Wrap in metadata object for agent consumption
        let output = serde_json::json!({
            "task_id": task_id,
            "stage": stage_name,
            "total": total,
            "offset": offset,
            "limit": limit,
            "entries": logs,
        });
        output_json(&output);
    }
}

fn print_log_entry_pretty(entry: &LogEntry) {
    match entry {
        LogEntry::Text { content } => println!("[text] {content}"),
        LogEntry::Error { message } => println!("[error] {message}"),
        LogEntry::ToolUse { tool, id, .. } => println!("[tool_use] {tool} ({id})"),
        LogEntry::ToolResult { tool, content, .. } => {
            let preview = content.chars().take(100).collect::<String>();
            println!("[tool_result] {tool}: {preview}");
        }
        LogEntry::ScriptStart { command, stage } => println!("[script_start] {stage}: {command}"),
        LogEntry::ScriptOutput { content } => println!("[script_output] {content}"),
        LogEntry::ScriptExit {
            code,
            success,
            timed_out,
        } => {
            println!("[script_exit] code={code} success={success} timed_out={timed_out}");
        }
        LogEntry::ProcessExit { code } => println!("[process_exit] code={code:?}"),
        LogEntry::UserMessage {
            resume_type,
            content,
        } => {
            println!("[user_message] ({resume_type}) {content}");
        }
        _ => {
            println!("[{}] ...", entry.type_name());
        }
    }
}

fn handle_create_task(
    api: &WorkflowApi,
    title: &str,
    description: &str,
    base_branch: Option<&str>,
    flow: Option<&str>,
    pretty: bool,
) {
    let task = match api.create_task_with_options(title, description, base_branch, false, flow) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error creating task: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        println!("Created task: {}", task.id);
        println!("Title: {}", task.title);
        println!("Stage: {}", task.current_stage().unwrap_or("-"));
        if let Some(branch) = &task.branch_name {
            println!("Branch: {branch}");
        }
        if let Some(worktree) = &task.worktree_path {
            println!("Worktree: {worktree}");
        }
    } else {
        output_json(&task);
    }
}

fn handle_approve_task(api: &WorkflowApi, id: &str, pretty: bool) {
    let task = match api.approve(id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error approving task: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        println!("Approved task: {}", task.id);
        if task.is_done() {
            println!("Status: Done");
        } else {
            println!("New stage: {}", task.current_stage().unwrap_or("-"));
        }
    } else {
        output_json(&task);
    }
}

fn handle_reject_task(api: &WorkflowApi, id: &str, feedback: &str, pretty: bool) {
    let task = match api.reject(id, feedback) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error rejecting task: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        println!("Rejected task: {}", task.id);
        println!(
            "Stage: {} (new iteration)",
            task.current_stage().unwrap_or("-")
        );
    } else {
        output_json(&task);
    }
}

fn handle_list_tasks(
    api: &WorkflowApi,
    status_filter: Option<&StatusFilter>,
    parent: Option<String>,
    depends_on: Option<String>,
    pretty: bool,
) {
    // Validate flag combinations
    if parent.is_some() && depends_on.is_some() {
        eprintln!("Error: --parent and --depends-on cannot be used together");
        std::process::exit(1);
    }

    if let Some(parent_id) = parent {
        handle_list_subtasks(api, &parent_id, status_filter, pretty);
    } else if let Some(depends_on_id) = depends_on {
        handle_list_dependents(api, &depends_on_id, status_filter, pretty);
    } else {
        handle_list_all_tasks(api, status_filter, pretty);
    }
}

fn handle_list_subtasks(
    api: &WorkflowApi,
    parent_id: &str,
    status_filter: Option<&StatusFilter>,
    pretty: bool,
) {
    let subtasks = match api.list_subtask_views(parent_id) {
        Ok(views) => views,
        Err(e) => {
            eprintln!("Error listing subtasks: {e}");
            std::process::exit(1);
        }
    };

    let subtasks: Vec<_> = match status_filter {
        Some(filter) => subtasks
            .into_iter()
            .filter(|v| matches_status_filter(&v.task, filter))
            .collect(),
        None => subtasks,
    };

    if pretty {
        print_subtasks_table(&subtasks);
    } else {
        output_json(&subtasks);
    }
}

fn handle_list_dependents(
    api: &WorkflowApi,
    depends_on_id: &str,
    status_filter: Option<&StatusFilter>,
    pretty: bool,
) {
    let all_tasks = match api.list_tasks() {
        Ok(tasks) => tasks,
        Err(e) => {
            eprintln!("Error listing tasks: {e}");
            std::process::exit(1);
        }
    };

    let dependents: Vec<_> = all_tasks
        .into_iter()
        .filter(|t| t.depends_on.contains(&depends_on_id.to_string()))
        .collect();

    let dependents: Vec<_> = match status_filter {
        Some(filter) => dependents
            .into_iter()
            .filter(|t| matches_status_filter(t, filter))
            .collect(),
        None => dependents,
    };

    if pretty {
        print_tasks_table(&dependents, "No dependent tasks found.");
    } else {
        output_json(&dependents);
    }
}

fn handle_list_all_tasks(api: &WorkflowApi, status_filter: Option<&StatusFilter>, pretty: bool) {
    let tasks = match api.list_tasks() {
        Ok(tasks) => tasks,
        Err(e) => {
            eprintln!("Error listing tasks: {e}");
            std::process::exit(1);
        }
    };

    let tasks: Vec<_> = match status_filter {
        Some(filter) => tasks
            .into_iter()
            .filter(|t| matches_status_filter(t, filter))
            .collect(),
        None => tasks,
    };

    if pretty {
        print_tasks_table(&tasks, "No tasks found.");
    } else {
        output_json(&tasks);
    }
}

fn print_subtasks_table(subtasks: &[TaskView]) {
    if subtasks.is_empty() {
        println!("No subtasks found.");
        return;
    }

    println!(
        "{:<36} {:<30} {:<25} {:<20}",
        "ID", "Title", "State", "Dependencies"
    );
    println!("{}", "-".repeat(111));

    for view in subtasks {
        let title = truncate_title(&view.task.title);
        let deps = if view.task.depends_on.is_empty() {
            "-".to_string()
        } else {
            view.task.depends_on.join(", ")
        };
        println!(
            "{:<36} {:<30} {:<25} {:<20}",
            view.task.id,
            title,
            format_state(&view.task.state),
            deps
        );
    }
}

fn print_tasks_table(tasks: &[Task], empty_message: &str) {
    if tasks.is_empty() {
        println!("{empty_message}");
        return;
    }

    println!("{:<36} {:<30} {:<25}", "ID", "Title", "State");
    println!("{}", "-".repeat(91));

    for task in tasks {
        let title = truncate_title(&task.title);
        println!(
            "{:<36} {:<30} {:<25}",
            task.id,
            title,
            format_state(&task.state),
        );
    }
}

fn truncate_title(title: &str) -> String {
    if title.chars().count() > 28 {
        format!("{}...", title.chars().take(25).collect::<String>())
    } else {
        title.to_string()
    }
}

#[allow(clippy::fn_params_excessive_bools)]
fn handle_show_task(
    api: &WorkflowApi,
    id: &str,
    show_iterations: bool,
    show_sessions: bool,
    show_git: bool,
    pretty: bool,
) {
    // If any flag is set, output only that specific data
    let any_flag_set = show_iterations || show_sessions || show_git;

    if any_flag_set {
        handle_show_task_filtered(api, id, show_iterations, show_sessions, show_git, pretty);
    } else {
        // No flags: show full task as before
        handle_show_task_full(api, id, pretty);
    }
}

fn handle_show_task_full(api: &WorkflowApi, id: &str, pretty: bool) {
    let task = match api.get_task(id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error getting task: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        println!("Task: {}", task.id);
        println!("Title: {}", task.title);
        println!("Description: {}", task.description);
        println!("State: {}", format_state(&task.state));

        if let Some(stage) = task.current_stage() {
            println!("Current Stage: {stage}");
        }

        if let Some(branch) = &task.branch_name {
            println!("Branch: {branch}");
        }

        if let Some(worktree) = &task.worktree_path {
            println!("Worktree: {worktree}");
        }

        if let Some(pr_url) = &task.pr_url {
            println!("PR: {pr_url}");
        }

        if let Some(parent) = &task.parent_id {
            println!("Parent: {parent}");
        }

        if !task.depends_on.is_empty() {
            println!("Dependencies: {}", task.depends_on.join(", "));
        }

        println!("Created: {}", task.created_at);
        println!("Updated: {}", task.updated_at);

        if let Some(completed) = &task.completed_at {
            println!("Completed: {completed}");
        }

        // Show artifacts
        let artifact_names: Vec<String> = task.artifacts.names().map(String::from).collect();
        if !artifact_names.is_empty() {
            println!("\nArtifacts:");
            for name in &artifact_names {
                if let Some(artifact) = task.artifacts.get(name) {
                    println!(
                        "  [{name}] (stage: {}, created: {})",
                        artifact.stage, artifact.created_at
                    );
                }
            }
        }
    } else {
        output_json(&task);
    }
}

#[allow(clippy::fn_params_excessive_bools)]
fn handle_show_task_filtered(
    api: &WorkflowApi,
    id: &str,
    show_iterations: bool,
    show_sessions: bool,
    show_git: bool,
    pretty: bool,
) {
    let mut output = serde_json::Map::new();

    if show_iterations {
        let iterations = match api.get_iterations(id) {
            Ok(iters) => iters,
            Err(e) => {
                eprintln!("Error getting iterations: {e}");
                std::process::exit(1);
            }
        };

        if pretty {
            print_iterations_pretty(&iterations);
        } else {
            output.insert(
                "iterations".to_string(),
                serde_json::to_value(&iterations).expect("domain type serialization"),
            );
        }
    }

    if show_sessions {
        let sessions = match api.get_stage_sessions(id) {
            Ok(sess) => sess,
            Err(e) => {
                eprintln!("Error getting stage sessions: {e}");
                std::process::exit(1);
            }
        };

        if pretty {
            print_sessions_pretty(&sessions);
        } else {
            output.insert(
                "sessions".to_string(),
                serde_json::to_value(&sessions).expect("domain type serialization"),
            );
        }
    }

    if show_git {
        let git_state = match get_git_state(api, id) {
            Ok(state) => state,
            Err(e) => {
                eprintln!("Error getting git state: {e}");
                std::process::exit(1);
            }
        };

        if pretty {
            print_git_state_pretty(&git_state);
        } else {
            output.insert(
                "git".to_string(),
                serde_json::to_value(&git_state).expect("domain type serialization"),
            );
        }
    }

    if !pretty {
        // Multiple flags: output combined JSON
        if output.len() == 1 {
            // Single flag: output just that array/object
            let (_key, value) = output
                .into_iter()
                .next()
                .expect("domain type serialization");
            println!(
                "{}",
                serde_json::to_string(&value).expect("domain type serialization")
            );
        } else {
            // Multiple flags: output combined object
            println!(
                "{}",
                serde_json::to_string(&output).expect("domain type serialization")
            );
        }
    }
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

fn handle_merge_task(api: &WorkflowApi, id: &str, pretty: bool) {
    // Validate preconditions (Done + Idle + no open PR) and mark as Integrating
    if let Err(e) = api.merge_task(id) {
        eprintln!("Error merging task: {e}");
        std::process::exit(1);
    }
    // Run the git pipeline synchronously (task is now Done + Integrating)
    let task = match api.integrate_task(id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error merging task: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        println!("Merged task {} into {}", task.id, task.base_branch);
        println!("State: {}", format_state(&task.state));
    } else {
        output_json(&task);
    }
}

#[allow(clippy::needless_pass_by_value)]
fn handle_open_pr_task(api: Arc<Mutex<WorkflowApi>>, id: &str, pretty: bool) {
    // Run the full PR pipeline synchronously (commit, push, gh pr create).
    let task = match create_pr_sync(Arc::clone(&api), id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error creating PR: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        if let Some(pr_url) = &task.pr_url {
            println!("Created PR for task {}", task.id);
            println!("PR: {pr_url}");
        } else {
            println!("Task {}: PR creation completed", task.id);
        }
        println!("State: {}", format_state(&task.state));
    } else {
        output_json(&task);
    }
}

fn handle_retry_pr_task(api: &WorkflowApi, id: &str, pretty: bool) {
    let task = match api.retry_pr_creation(id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error retrying PR creation: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        println!("Reset task {} to Done", task.id);
        println!("State: {}", format_state(&task.state));
        println!("You can now retry merge or PR creation");
    } else {
        output_json(&task);
    }
}

fn handle_push_pr_task(api: &WorkflowApi, id: &str, pretty: bool) {
    let task = match api.commit_and_push_pr_changes(id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error pushing PR changes: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        if let Some(pr_url) = &task.pr_url {
            println!("Pushed changes for task {}", task.id);
            println!("PR: {pr_url}");
        } else {
            println!("Pushed changes for task {}", task.id);
        }
        println!("State: {}", format_state(&task.state));
    } else {
        output_json(&task);
    }
}

fn handle_pull_pr_task(api: &WorkflowApi, id: &str, pretty: bool) {
    let task = match api.pull_pr_changes(id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error pulling PR changes: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        if let Some(pr_url) = &task.pr_url {
            println!("Pulled changes for task {}", task.id);
            println!("PR: {pr_url}");
        } else {
            println!("Pulled changes for task {}", task.id);
        }
        println!("State: {}", format_state(&task.state));
    } else {
        output_json(&task);
    }
}

fn handle_retry_task(api: &WorkflowApi, id: &str, instructions: Option<&str>, pretty: bool) {
    let task = match api.retry(id, instructions) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error retrying task: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        println!("Retried task {}", task.id);
        println!("Stage: {}", task.current_stage().unwrap_or("-"));
        println!("State: {}", format_state(&task.state));
        if instructions.is_some() {
            println!("Instructions provided to agent");
        }
    } else {
        output_json(&task);
    }
}

fn handle_address_feedback(api: &WorkflowApi, id: &str, guidance: Option<&str>, pretty: bool) {
    // Verify the task exists and has a PR URL.
    let task = match api.get_task(id) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error getting task: {e}");
            std::process::exit(1);
        }
    };

    let pr_url = if let Some(url) = &task.pr_url {
        url.clone()
    } else {
        eprintln!("Error: task {id} has no PR URL");
        std::process::exit(1);
    };

    // Fetch failing checks from GitHub (synchronous, no enrichment needed for CLI).
    let checks = match fetch_failing_checks(&pr_url) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error fetching PR checks: {e}");
            std::process::exit(1);
        }
    };

    if checks.is_empty() {
        eprintln!("No failing checks found for task {id}");
        std::process::exit(1);
    }

    let task = match api.address_pr_feedback(id, vec![], checks, guidance.map(str::to_owned)) {
        Ok(task) => task,
        Err(e) => {
            eprintln!("Error addressing PR feedback: {e}");
            std::process::exit(1);
        }
    };

    if pretty {
        println!("Addressing PR feedback for task {}", task.id);
        println!("Stage: {}", task.current_stage().unwrap_or("-"));
        println!("State: {}", format_state(&task.state));
    } else {
        output_json(&task);
    }
}

/// Run `gh pr view` and return all failing checks as `PrCheckData`.
///
/// Uses `std::process::Command` (sync) since the CLI is synchronous.
/// Does not fetch check-run summaries — check names are sufficient for agent context.
fn fetch_failing_checks(pr_url: &str) -> Result<Vec<PrCheckData>, String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CheckRollup {
        #[serde(default)]
        status_check_rollup: Vec<CheckEntry>,
    }

    #[derive(serde::Deserialize)]
    struct CheckEntry {
        name: String,
        status: Option<String>,
        conclusion: Option<String>,
    }

    let output = std::process::Command::new("gh")
        .args(["pr", "view", pr_url, "--json", "statusCheckRollup"])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            return Err(format!("gh pr view failed: {stderr}"));
        }
        Err(e) => {
            return Err(format!("failed to run gh: {e}"));
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    let rollup: CheckRollup =
        serde_json::from_str(&stdout).map_err(|e| format!("failed to parse gh output: {e}"))?;

    Ok(rollup
        .status_check_rollup
        .into_iter()
        .filter(|c| {
            orkestra_types::domain::classify_check(c.status.as_deref(), c.conclusion.as_deref())
                .is_failing()
        })
        .map(|c| PrCheckData {
            name: c.name,
            summary: None,
        })
        .collect())
}

/// Initialize the workflow API.
fn init_workflow_api() -> Result<WorkflowApi, String> {
    let project_root =
        find_project_root().map_err(|e| format!("Failed to find project root: {e}"))?;

    let orkestra_dir = project_root.join(".orkestra");
    let db_path = orkestra_dir.join(".database/orkestra.db");

    // Create .orkestra directory structure if needed
    orkestra_core::ensure_orkestra_project(&orkestra_dir)
        .map_err(|e| format!("Failed to create .orkestra structure: {e}"))?;

    // Load workflow config
    let workflow_config = load_workflow_for_project(&project_root)
        .map_err(|e| format!("Failed to load workflow config: {e}"))?;

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
            .with_pr_service(Arc::new(GhPrService::new()))
    } else {
        WorkflowApi::new(workflow_config, Arc::new(store))
    };

    Ok(api)
}

fn matches_status_filter(task: &Task, filter: &StatusFilter) -> bool {
    match filter {
        StatusFilter::Active => !task.state.is_terminal(),
        StatusFilter::Done => task.is_done(),
        StatusFilter::Archived => task.is_archived(),
        StatusFilter::Failed => task.is_failed(),
        StatusFilter::Blocked => task.is_blocked(),
    }
}

fn format_state(state: &TaskState) -> String {
    match state {
        TaskState::AwaitingSetup { stage } => format!("AwaitingSetup({stage})"),
        TaskState::SettingUp { stage } => format!("SettingUp({stage})"),
        TaskState::Queued { stage } => format!("Queued({stage})"),
        TaskState::AgentWorking { stage } => format!("Working({stage})"),
        TaskState::AwaitingGate { stage } => format!("AwaitingGate({stage})"),
        TaskState::GateRunning { stage } => format!("GateRunning({stage})"),
        TaskState::Finishing { stage } => format!("Finishing({stage})"),
        TaskState::Committing { stage } => format!("Committing({stage})"),
        TaskState::Committed { stage } => format!("Committed({stage})"),
        TaskState::Integrating => "Integrating".to_string(),
        TaskState::AwaitingApproval { stage } => format!("AwaitingApproval({stage})"),
        TaskState::AwaitingQuestionAnswer { stage } => format!("AwaitingQuestions({stage})"),
        TaskState::AwaitingRejectionConfirmation { stage } => {
            format!("AwaitingRejection({stage})")
        }
        TaskState::Interrupted { stage } => format!("Interrupted({stage})"),
        TaskState::WaitingOnChildren { stage } => format!("WaitingOnChildren({stage})"),
        TaskState::Done => "Done".to_string(),
        TaskState::Archived => "Archived".to_string(),
        TaskState::Failed { error } => {
            let msg = error.as_deref().unwrap_or("unknown");
            format!("Failed: {}", msg.chars().take(20).collect::<String>())
        }
        TaskState::Blocked { reason } => {
            let msg = reason.as_deref().unwrap_or("unknown");
            format!("Blocked: {}", msg.chars().take(20).collect::<String>())
        }
    }
}

fn format_outcome(outcome: &Outcome) -> String {
    match outcome {
        Outcome::Approved => "approved".to_string(),
        Outcome::Rejected { feedback, .. } => format!("rejected\n    Feedback: {feedback}"),
        Outcome::AwaitingAnswers { questions, .. } => {
            format!("awaiting answers ({} questions)", questions.len())
        }
        Outcome::Completed { .. } => "completed".to_string(),
        Outcome::IntegrationFailed { error, .. } => {
            format!("integration failed\n    Error: {error}")
        }
        Outcome::AgentError { error } => format!("agent error\n    Error: {error}"),
        Outcome::SpawnFailed { error } => format!("spawn failed\n    Error: {error}"),
        Outcome::Blocked { reason } => format!("blocked\n    Reason: {reason}"),
        Outcome::Skipped { reason, .. } => format!("skipped\n    Reason: {reason}"),
        Outcome::Rejection {
            target, feedback, ..
        } => {
            format!("rejection (to {target})\n    Feedback: {feedback}")
        }
        Outcome::AwaitingRejectionReview {
            target, feedback, ..
        } => {
            format!("awaiting rejection review (to {target})\n    Feedback: {feedback}")
        }
        Outcome::GateFailed { error, .. } => format!("gate failed\n    Error: {error}"),
        Outcome::Interrupted => "interrupted".to_string(),
        Outcome::CommitFailed { error } => format!("commit failed\n    Error: {error}"),
    }
}

fn format_trigger(trigger: &IterationTrigger) -> String {
    match trigger {
        IterationTrigger::Feedback { feedback } => format!("feedback\n    \"{feedback}\""),
        IterationTrigger::Rejection {
            from_stage,
            feedback,
        } => {
            format!("rejection from {from_stage}\n    \"{feedback}\"")
        }
        IterationTrigger::Integration {
            message,
            conflict_files,
        } => {
            let mut s = format!("integration failure\n    {message}");
            if !conflict_files.is_empty() {
                write!(s, "\n    Conflicts: {}", conflict_files.join(", ")).unwrap();
            }
            s
        }
        IterationTrigger::Answers { answers } => format!("{} answers provided", answers.len()),
        IterationTrigger::Interrupted => "interrupted (crash recovery)".to_string(),
        IterationTrigger::GateFailure { error } => {
            format!("gate failure\n    {error}")
        }
        IterationTrigger::RetryFailed { instructions } => {
            let mut s = "retry failed".to_string();
            if let Some(inst) = instructions {
                write!(s, "\n    Instructions: {inst}").unwrap();
            }
            s
        }
        IterationTrigger::RetryBlocked { instructions } => {
            let mut s = "retry blocked".to_string();
            if let Some(inst) = instructions {
                write!(s, "\n    Instructions: {inst}").unwrap();
            }
            s
        }
        IterationTrigger::ManualResume { message } => {
            let mut s = "manual resume".to_string();
            if let Some(msg) = message {
                write!(s, "\n    Message: {msg}").unwrap();
            }
            s
        }
        IterationTrigger::PrFeedback {
            comments,
            checks,
            guidance,
        } => {
            let mut s = format!(
                "PR feedback ({} comments, {} checks)",
                comments.len(),
                checks.len()
            );
            for c in comments {
                let location = match (&c.path, c.line) {
                    (Some(p), Some(l)) => format!(" ({p}:{l})"),
                    (Some(p), None) => format!(" ({p})"),
                    _ => String::new(),
                };
                write!(s, "\n    - @{}{}: {}", c.author, location, c.body).unwrap();
            }
            for c in checks {
                let summary = c.summary.as_deref().unwrap_or("no details");
                write!(s, "\n    - [check] {}: {}", c.name, summary).unwrap();
            }
            if let Some(g) = guidance {
                write!(s, "\n    Guidance: {g}").unwrap();
            }
            s
        }
        IterationTrigger::ReturnToWork { .. } => "return to work (exited chat mode)".to_string(),
    }
}

fn print_iterations_pretty(iterations: &[Iteration]) {
    if iterations.is_empty() {
        println!("No iterations found.");
        return;
    }

    for iteration in iterations {
        println!(
            "Iteration #{} [{}]",
            iteration.iteration_number, iteration.stage
        );
        println!("  Started: {}", iteration.started_at);

        if let Some(ended) = &iteration.ended_at {
            println!("  Ended: {ended}");
        } else {
            println!("  Ended: (still active)");
        }

        if let Some(outcome) = &iteration.outcome {
            println!("  Outcome: {}", format_outcome(outcome));
        } else {
            println!("  Outcome: (none)");
        }

        if let Some(context) = &iteration.incoming_context {
            println!("  Context: {}", format_trigger(context));
        }

        println!();
    }
}

fn print_sessions_pretty(sessions: &[StageSession]) {
    if sessions.is_empty() {
        println!("No stage sessions found.");
        return;
    }

    for session in sessions {
        println!("Session [{}]", session.stage);
        println!("  ID: {}", session.id);
        println!("  State: {:?}", session.session_state);
        println!("  Spawn count: {}", session.spawn_count);

        if let Some(session_id) = &session.claude_session_id {
            println!("  Claude session ID: {session_id}");
        }

        if let Some(pid) = session.agent_pid {
            println!("  Agent PID: {pid}");
        }

        println!("  Created: {}", session.created_at);
        println!("  Updated: {}", session.updated_at);
        println!();
    }
}

fn print_git_state_pretty(state: &GitState) {
    println!("Git State:");
    if let Some(branch) = &state.branch_name {
        println!("  Branch: {branch}");
    } else {
        println!("  Branch: (not set)");
    }

    if let Some(worktree) = &state.worktree_path {
        println!("  Worktree: {worktree}");
    } else {
        println!("  Worktree: (not set)");
    }

    println!("  Base branch: {}", state.base_branch);
    println!("  Base commit: {}", state.base_commit);

    if let Some(head) = &state.head_commit {
        println!("  HEAD commit: {head}");
    } else {
        println!("  HEAD commit: (worktree not available)");
    }

    if let Some(error) = &state.error {
        println!("  Error: {error}");
    }

    match state.is_dirty {
        Some(true) => {
            println!("  Status: dirty ({} files)", state.dirty_files.len());
            if !state.dirty_files.is_empty() {
                println!("  Dirty files:");
                for file in &state.dirty_files {
                    println!("    {file}");
                }
            }
        }
        Some(false) => println!("  Status: clean"),
        None => println!("  Status: (worktree not available)"),
    }
}
