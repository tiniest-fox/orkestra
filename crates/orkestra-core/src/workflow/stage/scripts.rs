//! Script execution service for running gate scripts attached to agent stages.
//!
//! Tracks active script handles and delegates spawn + poll to interactions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::workflow::config::GateConfig;
use crate::workflow::domain::Task;
use crate::workflow::execution::{ScriptHandle, ScriptResult};
use crate::workflow::ports::WorkflowStore;

// ============================================================================
// Types
// ============================================================================

/// Handle for tracking a running gate script execution.
pub struct ActiveScript {
    /// Task being executed.
    pub task_id: String,
    /// Stage being executed.
    pub stage: String,
    /// The script handle (owns the process).
    pub handle: ScriptHandle,
    /// Iteration ID for gate result storage.
    pub iteration_id: Option<String>,
    /// Accumulated output lines (built up per poll tick).
    pub lines: Vec<String>,
    /// When the gate script was spawned (RFC3339).
    pub started_at: String,
}

/// Result of polling an active script.
pub enum ScriptPollResult {
    /// Script is still running.
    Running,
    /// Script completed.
    Completed(ScriptCompletion),
    /// Error checking script status.
    Error {
        /// Task ID of the affected task.
        task_id: String,
        /// Stage name of the affected stage.
        stage: String,
        /// Error message.
        message: String,
    },
}

/// Information about a completed script.
pub struct ScriptCompletion {
    /// Task ID.
    pub task_id: String,
    /// Stage name.
    pub stage: String,
    /// The script result.
    pub result: ScriptResult,
}

/// Errors that can occur during script execution.
#[derive(Debug)]
pub enum ScriptError {
    /// Failed to spawn script.
    SpawnFailed(String),
    /// Lock error.
    LockError,
}

impl std::fmt::Display for ScriptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SpawnFailed(msg) => write!(f, "Failed to spawn script: {msg}"),
            Self::LockError => write!(f, "Lock error"),
        }
    }
}

impl std::error::Error for ScriptError {}

// ============================================================================
// Script Execution Service
// ============================================================================

/// Service for managing gate script execution.
///
/// Tracks active script handles and delegates spawn/poll to interactions.
pub struct ScriptExecutionService {
    /// Project root for resolving paths.
    project_root: PathBuf,
    /// Store for persisting log entries.
    store: Arc<dyn WorkflowStore>,
    /// Active script executions keyed by task ID.
    active_scripts: Mutex<HashMap<String, ActiveScript>>,
}

impl ScriptExecutionService {
    /// Create a new script execution service.
    pub fn new(project_root: PathBuf, store: Arc<dyn WorkflowStore>) -> Self {
        Self {
            project_root,
            store,
            active_scripts: Mutex::new(HashMap::new()),
        }
    }

    // -- Active Script Tracking --

    /// Check if a task has an active script execution.
    pub fn has_active_script(&self, task_id: &str) -> bool {
        self.active_scripts
            .lock()
            .is_ok_and(|scripts| scripts.contains_key(task_id))
    }

    /// Get the number of active scripts.
    pub fn active_count(&self) -> usize {
        self.active_scripts.lock().map(|s| s.len()).unwrap_or(0)
    }

    /// Get the set of task IDs with active script executions.
    pub fn active_script_task_ids(&self) -> std::collections::HashSet<String> {
        self.active_scripts
            .lock()
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default()
    }

    // -- Spawn & Poll --

    /// Spawn a gate script for a task.
    ///
    /// Returns the process ID of the spawned gate. The gate has no `recovery_stage` —
    /// failure always re-queues the task in the same stage with `GateFailure` context.
    pub fn spawn_gate(
        &self,
        task: &Task,
        stage: &str,
        gate_config: &GateConfig,
        iteration_id: Option<&str>,
    ) -> Result<u32, ScriptError> {
        let active_script = super::interactions::spawn_script::execute(
            &self.project_root,
            task,
            stage,
            gate_config,
            iteration_id,
        )?;

        let pid = active_script.handle.pid();

        self.active_scripts
            .lock()
            .map_err(|_| ScriptError::LockError)?
            .insert(task.id.clone(), active_script);

        Ok(pid)
    }

    /// Kill the active gate script for a task.
    ///
    /// Returns the PID that was killed, or None if no active gate was found.
    pub fn kill_gate(&self, task_id: &str) -> Option<u32> {
        let pid = self
            .active_scripts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(task_id)
            .map(|s| s.handle.pid());

        if let Some(pid) = pid {
            if let Err(e) = orkestra_process::kill_process_tree(pid) {
                crate::orkestra_debug!(
                    "interrupt",
                    "Failed to kill gate process tree {}: {}",
                    pid,
                    e
                );
            }
        }

        pid
    }

    /// Poll all active scripts for completion.
    ///
    /// Returns a list of poll results. Incremental output is written to the
    /// database as it arrives, allowing real-time log viewing.
    pub fn poll_active_scripts(&self) -> Vec<ScriptPollResult> {
        let mut results = Vec::new();
        let mut completed_task_ids = Vec::new();

        if let Ok(mut scripts) = self.active_scripts.lock() {
            for (task_id, script) in scripts.iter_mut() {
                let result = super::interactions::poll_script::execute(self.store.as_ref(), script);
                match &result {
                    ScriptPollResult::Completed(_) | ScriptPollResult::Error { .. } => {
                        completed_task_ids.push(task_id.clone());
                    }
                    ScriptPollResult::Running => {}
                }
                results.push(result);
            }

            // Remove completed scripts
            for task_id in completed_task_ids {
                scripts.remove(&task_id);
            }
        }

        results
    }
}
