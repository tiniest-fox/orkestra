// Legacy modules (to be removed after migration)
pub mod agents;
pub mod project;
pub mod tasks;

// New modular architecture
pub mod error;
pub mod domain;
pub mod ports;
pub mod adapters;
pub mod services;
pub mod prompt;

// Legacy re-exports (for backward compatibility during migration)
pub use agents::{spawn_agent, spawn_agent_sync, resume_agent, recover_session_logs, get_claude_session_path, SpawnedAgent, AgentType};
pub use project::{find_project_root, get_orkestra_dir};
pub use tasks::{Task, TaskStatus, TaskKind, LogEntry, ToolInput, SessionInfo, load_tasks, save_tasks, add_task_session, create_task_with_options};

// New architecture re-exports
pub use error::{OrkestraError, Result};
pub use domain::{Task as DomainTask, TaskStatus as DomainTaskStatus, TaskKind as DomainTaskKind, SessionInfo as DomainSessionInfo, LogEntry as DomainLogEntry, ToolInput as DomainToolInput};
pub use ports::{TaskStore, ProcessSpawner, SpawnConfig, SpawnedProcess, Clock};
pub use adapters::{SqliteStore, ClaudeSpawner, SystemClock, FixedClock};
pub use services::{TaskService, AgentService};
pub use prompt::{build_planner_prompt, build_worker_prompt};
