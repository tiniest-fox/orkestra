// Core modules - new workflow system
pub mod adapters;
pub mod debug_log;
pub mod error;
pub mod process;
pub mod project;
pub mod prompts;
pub mod title;
pub mod workflow;

// Test utilities (available for integration tests)
#[cfg(any(test, feature = "testutil"))]
pub mod testutil;

// Error types
pub use error::{OrkestraError, Result};

// Title generation
pub use title::generate_title_sync;

// Process infrastructure re-exports
pub use process::{
    is_process_running, kill_process_tree, spawn_claude_process, write_prompt_to_stdin,
    ParsedStreamEvent, ProcessGuard,
};

// Project discovery re-exports
pub use project::{find_project_root, get_orkestra_dir};
