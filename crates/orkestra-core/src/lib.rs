// Core modules
pub mod adapters;
pub mod agents;
pub mod auto_tasks;
pub mod domain;
pub mod error;
pub mod orchestrator;
pub mod ports;
pub mod project;
pub mod prompts;
pub mod services;
pub mod session_logs;
pub mod tasks;

// Test utilities (available for integration tests)
#[cfg(any(test, feature = "testutil"))]
pub mod testutil;

// Primary re-exports
pub use domain::{IntegrationResult, LogEntry, SessionInfo, Task, TaskKind, TaskStatus, ToolInput};
pub use error::{OrkestraError, Result};
pub use services::Project;

// Agent re-exports
pub use agents::{
    generate_title_sync, resume_agent, spawn_agent, spawn_agent_sync, AgentType, SpawnedAgent,
};

// Project discovery re-exports
pub use project::{find_project_root, get_orkestra_dir};

// Session logs re-exports
pub use session_logs::{
    get_claude_session_path, get_claude_session_path_from_project, recover_session_logs,
};

// Auto-tasks re-exports
pub use auto_tasks::{get_auto_task, list_auto_tasks, AutoTask};

// Infrastructure re-exports
pub use adapters::{ClaudeSpawner, FixedClock, SqliteStore, SystemClock};
pub use ports::{Clock, ProcessSpawner, SpawnConfig, SpawnedProcess, TaskStore};
pub use prompts::{
    build_breakdown_prompt, build_planner_prompt, build_reviewer_prompt,
    build_title_generator_prompt, build_worker_prompt,
    // Resume prompts
    render_resume_breakdown, render_resume_planner, render_resume_reviewer, render_resume_worker,
    ResumeBreakdownContext, ResumePlannerContext, ResumeReviewerContext, ResumeWorkerContext,
};
pub use services::{AgentService, GitService, TaskService};
