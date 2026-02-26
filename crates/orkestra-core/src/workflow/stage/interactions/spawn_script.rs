//! Spawn a gate script for a workflow stage.
//!
//! Builds environment, and spawns the gate process. Returns an `ActiveScript` for tracking.

use std::path::Path;
use std::time::Duration;

use crate::workflow::config::GateConfig;
use crate::workflow::domain::Task;
use crate::workflow::execution::{ScriptEnv, ScriptHandle};
use crate::workflow::stage::scripts::{ActiveScript, ScriptError};

// ============================================================================
// Entry Points
// ============================================================================

/// Spawn a gate script for a task's agent stage.
///
/// Gate scripts have no `recovery_stage` (failure always re-queues in the same stage).
/// Returns an `ActiveScript` that the caller inserts into its tracking map.
pub(crate) fn execute_gate(
    project_root: &Path,
    task: &Task,
    stage: &str,
    gate_config: &GateConfig,
) -> Result<ActiveScript, ScriptError> {
    let command = gate_config.command.clone();
    let timeout = Duration::from_secs(gate_config.timeout_seconds);
    let working_dir = task
        .worktree_path
        .as_ref()
        .map_or_else(|| project_root.to_path_buf(), std::path::PathBuf::from);

    let env = build_script_env(project_root, task);

    // Spawn the gate with environment variables
    let handle = ScriptHandle::spawn_with_env(&command, &working_dir, timeout, &env)
        .map_err(|e| ScriptError::SpawnFailed(e.to_string()))?;

    Ok(ActiveScript {
        task_id: task.id.clone(),
        stage: stage.to_string(),
        handle,
        stage_session_id: String::new(), // Gates have no session
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
