// Legacy modules (to be removed after migration)
pub mod agents;
pub mod project;
pub mod session_logs;
pub mod tasks;

// New modular architecture
pub mod adapters;
pub mod domain;
pub mod error;
pub mod ports;
pub mod prompt;
pub mod services;

// Legacy re-exports (for backward compatibility during migration)
pub use agents::{resume_agent, spawn_agent, spawn_agent_sync, AgentType, SpawnedAgent};
pub use session_logs::{get_claude_session_path, recover_session_logs};
pub use project::{find_project_root, get_orkestra_dir};
pub use tasks::{
    add_task_session, create_task_with_options, load_tasks, save_tasks, LogEntry, SessionInfo,
    Task, TaskKind, TaskStatus, ToolInput,
};

// New architecture re-exports
pub use adapters::{ClaudeSpawner, FixedClock, SqliteStore, SystemClock};
pub use domain::{
    LogEntry as DomainLogEntry, SessionInfo as DomainSessionInfo, Task as DomainTask,
    TaskKind as DomainTaskKind, TaskStatus as DomainTaskStatus, ToolInput as DomainToolInput,
};
pub use error::{OrkestraError, Result};
pub use ports::{Clock, ProcessSpawner, SpawnConfig, SpawnedProcess, TaskStore};
pub use prompt::{build_planner_prompt, build_worker_prompt};
pub use services::{AgentService, TaskService};
