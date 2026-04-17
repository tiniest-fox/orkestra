//! Process management re-exports.
//!
//! Generic process management lives in the `orkestra-process` crate.
//! CLI path discovery and spawner adapters live in `orkestra-agent`.
//! This module re-exports commonly used items so callers can import
//! from `orkestra_core::process` without taking direct dependencies.

pub use orkestra_process::{
    is_process_running, is_zombie, kill_process_tree, parse_stream_event, spawn_stderr_reader,
    ParsedStreamEvent, ProcessGuard,
};

pub use orkestra_agent::interactions::spawner::cli_path::{find_cli_path, prepare_path_env};
