//! Spawn a script for a workflow stage.
//!
//! Resolves script config, builds environment, writes the start log entry,
//! and spawns the process. Returns an `ActiveScript` for tracking.

use std::path::Path;
use std::time::Duration;

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{LogEntry, Task};
use crate::workflow::execution::{ScriptEnv, ScriptHandle};
use crate::workflow::ports::WorkflowStore;
use crate::workflow::stage::scripts::{ActiveScript, ScriptError};

// ============================================================================
// Entry Point
// ============================================================================

/// Spawn a script for a task's stage.
///
/// Returns an `ActiveScript` that the caller inserts into its tracking map.
pub(crate) fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    project_root: &Path,
    task: &Task,
    stage: &str,
    stage_session_id: Option<&str>,
) -> Result<ActiveScript, ScriptError> {
    let script_config = workflow
        .stages
        .iter()
        .find(|s| s.name == stage)
        .and_then(|s| s.script.as_ref())
        .ok_or_else(|| ScriptError::NoConfig(stage.to_string()))?;

    let command = script_config.command.clone();
    let timeout = Duration::from_secs(u64::from(script_config.timeout_seconds));
    let recovery_stage = script_config.on_failure.clone();
    let working_dir = task
        .worktree_path
        .as_ref()
        .map_or_else(|| project_root.to_path_buf(), std::path::PathBuf::from);

    let env = build_script_env(project_root, task);

    // Use caller-provided session ID, or look up from store as fallback
    let stage_session_id = stage_session_id.map_or_else(
        || {
            store
                .get_stage_session(&task.id, stage)
                .ok()
                .flatten()
                .map_or_else(|| format!("{}-{}", task.id, stage), |s| s.id)
        },
        String::from,
    );

    // Write initial log entry to database
    append_log_entry(
        store,
        &stage_session_id,
        &LogEntry::ScriptStart {
            command: command.clone(),
            stage: stage.to_string(),
        },
    )?;

    // Spawn the script with environment variables
    let handle = ScriptHandle::spawn_with_env(&command, &working_dir, timeout, &env)
        .map_err(|e| ScriptError::SpawnFailed(e.to_string()))?;

    Ok(ActiveScript {
        task_id: task.id.clone(),
        stage: stage.to_string(),
        command,
        handle,
        recovery_stage,
        stage_session_id,
    })
}

// ============================================================================
// Helpers
// ============================================================================

/// Build environment variables for script execution.
fn build_script_env(project_root: &Path, task: &Task) -> ScriptEnv {
    ScriptEnv::new()
        .with("ORKESTRA_TASK_ID", &task.id)
        .with("ORKESTRA_TASK_TITLE", &task.title)
        .with_opt("ORKESTRA_BRANCH", task.branch_name.as_ref())
        .with("ORKESTRA_BASE_BRANCH", &task.base_branch)
        .with_opt("ORKESTRA_WORKTREE_PATH", task.worktree_path.as_ref())
        .with(
            "ORKESTRA_PROJECT_ROOT",
            project_root.to_string_lossy().as_ref(),
        )
        .with_opt("ORKESTRA_PARENT_ID", task.parent_id.as_ref())
}

/// Persist a log entry to the database via the workflow store.
fn append_log_entry(
    store: &dyn WorkflowStore,
    stage_session_id: &str,
    entry: &LogEntry,
) -> Result<(), ScriptError> {
    store
        .append_log_entry(stage_session_id, entry)
        .map_err(|e| ScriptError::LogError(e.to_string()))
}
