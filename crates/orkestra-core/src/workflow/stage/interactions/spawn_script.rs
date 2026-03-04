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
pub(crate) fn execute(
    project_root: &Path,
    task: &Task,
    stage: &str,
    gate_config: &GateConfig,
    iteration_id: Option<&str>,
) -> Result<ActiveScript, ScriptError> {
    let command = gate_config.command.clone();
    let timeout = Duration::from_secs(gate_config.timeout_seconds);
    let working_dir = task
        .worktree_path
        .as_ref()
        .map_or_else(|| project_root.to_path_buf(), std::path::PathBuf::from);

    let env = build_script_env(project_root, task);

    // Resolve project-specific environment for the gate script
    let resolved_env =
        orkestra_agent::resolve_agent_env(project_root, std::env::var("SHELL").ok().as_deref());

    let handle = if let Some(base_env) = resolved_env {
        ScriptHandle::spawn_with_base_env(&command, &working_dir, timeout, &base_env, &env)
    } else {
        ScriptHandle::spawn_with_env(&command, &working_dir, timeout, &env)
    }
    .map_err(|e| ScriptError::SpawnFailed(format!("command={command} {e}")))?;

    Ok(ActiveScript {
        task_id: task.id.clone(),
        stage: stage.to_string(),
        handle,
        iteration_id: iteration_id.map(str::to_string),
        lines: Vec::new(),
        started_at: chrono::Utc::now().to_rfc3339(),
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
