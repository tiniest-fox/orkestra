//! Project environment metadata.

use serde::Serialize;

/// Relative path from project root to the run script.
pub const RUN_SCRIPT_RELATIVE_PATH: &str = ".orkestra/scripts/run.sh";

/// Metadata about a project's environment.
///
/// Returned by `get_project_info` — both the Tauri command and the WebSocket handler.
#[derive(Debug, Serialize)]
pub struct ProjectInfo {
    /// Absolute path to the project root.
    pub project_root: String,
    /// Whether a git service is available for this project.
    pub has_git: bool,
    /// Whether the `gh` CLI is available for PR creation.
    pub has_gh_cli: bool,
    /// Whether `.orkestra/scripts/run.sh` exists for this project.
    pub has_run_script: bool,
}
