//! Process cleanup and task deletion with agent termination.
//!
//! Provides cleanup methods on `WorkflowApi` for:
//! - Killing running agents (shutdown, deletion, orphan recovery)
//! - Deleting tasks with full cleanup (kill agents + delete DB records)
//! - Stale lock cleanup on startup

use std::path::Path;

use crate::process::{is_process_running, kill_process_tree};
use crate::workflow::ports::WorkflowResult;

use super::WorkflowApi;

impl WorkflowApi {
    /// Kill all tracked running agents.
    ///
    /// Queries the database for all sessions with agent PIDs, checks which
    /// processes are still alive, and kills their process trees.
    ///
    /// Returns the number of agents killed.
    pub fn kill_running_agents(&self) -> WorkflowResult<usize> {
        let running_agents = self.get_running_agent_pids()?;
        let mut killed = 0;

        for (task_id, stage, pid) in running_agents {
            if is_process_running(pid) {
                crate::orkestra_debug!(
                    "cleanup",
                    "Killing agent for task {task_id}/{stage} (pid: {pid})"
                );
                if let Err(e) = kill_process_tree(pid) {
                    crate::orkestra_debug!(
                        "cleanup",
                        "Failed to kill agent pid {pid} for {task_id}/{stage}: {e}"
                    );
                }
                killed += 1;
            }
        }

        Ok(killed)
    }

    /// Kill running agents for specific task IDs.
    ///
    /// Best-effort: failures are logged but do not propagate.
    /// Used before task deletion to terminate agents for the task tree.
    pub fn kill_agents_for_tasks(&self, task_ids: &[String]) {
        let Ok(all_agents) = self.get_running_agent_pids() else {
            return;
        };

        for (task_id, stage, pid) in all_agents {
            if task_ids.contains(&task_id) && is_process_running(pid) {
                crate::orkestra_debug!(
                    "cleanup",
                    "Killing agent for task {task_id}/{stage} (pid: {pid})"
                );
                if let Err(e) = kill_process_tree(pid) {
                    crate::orkestra_debug!(
                        "cleanup",
                        "Failed to kill agent pid {pid} for {task_id}/{stage}: {e}"
                    );
                }
            }
        }
    }

    /// Kill orphaned agents and clear stale PIDs from sessions.
    ///
    /// Called on startup to recover from previous crashes. For each session
    /// with a recorded PID:
    /// - If the process is still running, kill it (it's orphaned)
    /// - Clear the PID from the session so the next spawn works correctly
    ///
    /// Returns the number of orphaned agents found and killed.
    pub fn cleanup_orphaned_agents(&self) -> WorkflowResult<usize> {
        let running_agents = self.get_running_agent_pids()?;
        let mut orphans_found = 0;

        for (task_id, stage, pid) in running_agents {
            if is_process_running(pid) {
                crate::orkestra_debug!(
                    "cleanup",
                    "Found orphaned agent for task {task_id}/{stage} (pid: {pid}), killing..."
                );
                let _ = kill_process_tree(pid);
                orphans_found += 1;
            }
            // Clear the stale PID from the session
            let _ = self.clear_session_agent_pid(&task_id, &stage);
        }

        Ok(orphans_found)
    }

    /// Delete a task with full cleanup.
    ///
    /// 1. Collects the task tree (task + all descendant subtasks)
    /// 2. Kills running agents for all tasks in the tree (best-effort)
    /// 3. Deletes all DB records atomically
    pub fn delete_task_with_cleanup(&self, id: &str) -> WorkflowResult<()> {
        // Collect all task IDs in the tree
        let mut task_ids = vec![id.to_string()];
        self.collect_subtask_ids(id, &mut task_ids)?;

        // Kill running agents (best-effort, instant signal sends)
        self.kill_agents_for_tasks(&task_ids);

        // Delete all DB records in a transaction
        self.store.delete_task_tree(&task_ids)
    }
}

/// Remove stale target lock directory left behind by killed check scripts.
///
/// Called on startup as a safety net. If the lock directory exists and the
/// PID file references a dead process (or is missing), the lock is removed.
/// If the lock holder is still alive, the lock is left in place.
pub fn cleanup_stale_target_lock(project_root: &Path) {
    let lock_dir = project_root.join(".orkestra/target.lock.d");
    if !lock_dir.exists() {
        return;
    }

    let pid_file = lock_dir.join("pid");
    let should_remove = if pid_file.exists() {
        match std::fs::read_to_string(&pid_file) {
            Ok(contents) => match contents.trim().parse::<u32>() {
                Ok(pid) => !is_process_running(pid),
                Err(_) => true, // Can't parse PID — stale
            },
            Err(_) => true, // Can't read PID file — stale
        }
    } else {
        true // No PID file — stale
    };

    if should_remove {
        crate::orkestra_debug!(
            "cleanup",
            "Removing stale target lock at {}",
            lock_dir.display()
        );
        let _ = std::fs::remove_dir_all(&lock_dir);
    }
}
