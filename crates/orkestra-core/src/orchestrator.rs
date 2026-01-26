//! Orchestrator module - periodically checks task state and spawns agents as needed.
//!
//! This implements a reconciliation loop pattern: instead of spawning agents
//! at every state transition, we periodically check what should be running
//! and start/resume agents as needed.

use crate::domain::{IntegrationResult, Task, TaskKind, TaskStatus};
use crate::services::Project;
use crate::tasks;

/// Represents an action the orchestrator wants to take
#[derive(Debug, Clone)]
pub enum OrchestratorAction {
    /// Spawn a new planner agent for this task
    SpawnPlanner(Task),
    /// Spawn a new breakdown agent for this task
    SpawnBreakdown(Task),
    /// Spawn a new worker agent for this task
    SpawnWorker(Task),
    /// Resume an existing worker session for this task
    ResumeWorker { task: Task, session_key: String },
    /// Spawn a new reviewer agent for this task
    SpawnReviewer(Task),
    /// Resume an existing reviewer session for this task
    ResumeReviewer { task: Task, session_key: String },
    /// Integrate a done task's branch back to primary, then cleanup
    IntegrateDoneTask(Task),
}

/// Check if a process with the given PID is still running
#[allow(clippy::cast_possible_wrap)] // PIDs won't exceed i32::MAX in practice
fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // On Unix, kill with signal 0 checks if process exists without killing it
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        // On Windows, try to open the process
        use std::ptr::null_mut;
        unsafe {
            let handle = windows_sys::Win32::System::Threading::OpenProcess(
                windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if handle.is_null() {
                false
            } else {
                windows_sys::Win32::Foundation::CloseHandle(handle);
                true
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        // Fallback: assume not running
        let _ = pid;
        false
    }
}

/// Check if a task has a running agent by checking the task's `agent_pid` field
fn has_running_agent(task: &Task) -> bool {
    // Check the top-level agent_pid field (set immediately when spawning)
    if let Some(pid) = task.agent_pid {
        if is_process_running(pid) {
            return true;
        }
    }

    false
}

/// Check if task is waiting for human review (has output but needs approval)
fn needs_human_review(task: &Task) -> bool {
    match task.status {
        TaskStatus::Planning => task.plan.is_some(),
        TaskStatus::BreakingDown => task.breakdown.is_some(),
        TaskStatus::Working => task.summary.is_some(),
        _ => false,
    }
}

/// Get the session key for resuming a task, if one exists
fn get_resume_session_key(task: &Task) -> Option<String> {
    let sessions = task.sessions.as_ref()?;
    let keys: Vec<_> = sessions.keys().collect();
    keys.last().map(|k| (*k).clone())
}

/// Determine what actions need to be taken for the current task state.
/// This is the core reconciliation logic.
pub fn check_tasks(project: &Project) -> crate::error::Result<Vec<OrchestratorAction>> {
    let all_tasks = tasks::load_tasks(project)?;
    let mut actions = Vec::new();

    for task in all_tasks {
        // Skip subtasks - they don't get their own agents
        if task.kind == TaskKind::Subtask {
            continue;
        }

        // Skip if agent is already running
        if has_running_agent(&task) {
            continue;
        }

        // Skip if waiting for human review
        if needs_human_review(&task) {
            continue;
        }

        // Determine what action is needed based on status
        let action = match task.status {
            TaskStatus::Planning => {
                // Need to plan - check if we can resume or need fresh start
                if let Some(session_key) = get_resume_session_key(&task) {
                    if session_key == "plan" {
                        // Has a plan session, but agent not running - resume it
                        Some(OrchestratorAction::ResumeWorker {
                            task: task.clone(),
                            session_key,
                        })
                    } else {
                        Some(OrchestratorAction::SpawnPlanner(task.clone()))
                    }
                } else {
                    Some(OrchestratorAction::SpawnPlanner(task.clone()))
                }
            }
            TaskStatus::BreakingDown => {
                // Need to break down - spawn breakdown agent
                Some(OrchestratorAction::SpawnBreakdown(task.clone()))
            }
            TaskStatus::Working => {
                // Need to work - check if we can resume
                if let Some(session_key) = get_resume_session_key(&task) {
                    if session_key == "work" || session_key.starts_with("work") {
                        Some(OrchestratorAction::ResumeWorker {
                            task: task.clone(),
                            session_key,
                        })
                    } else {
                        Some(OrchestratorAction::SpawnWorker(task.clone()))
                    }
                } else {
                    Some(OrchestratorAction::SpawnWorker(task.clone()))
                }
            }
            TaskStatus::Reviewing => {
                // Need to review - check if we can resume
                if let Some(session_key) = get_resume_session_key(&task) {
                    if session_key == "review" || session_key.starts_with("review") {
                        Some(OrchestratorAction::ResumeReviewer {
                            task: task.clone(),
                            session_key,
                        })
                    } else {
                        Some(OrchestratorAction::SpawnReviewer(task.clone()))
                    }
                } else {
                    Some(OrchestratorAction::SpawnReviewer(task.clone()))
                }
            }
            TaskStatus::WaitingOnSubtasks => {
                // Parent is waiting - check child tasks
                // Child tasks will be handled in their own iteration
                None
            }
            TaskStatus::Done => {
                // Done tasks may need integration (merge branch, cleanup worktree)
                // Integrate if task has a branch and either:
                // - No integration result yet
                // - Previous result was Conflict or Skipped (needs retry)
                let needs_integration = task.branch_name.is_some()
                    && !matches!(
                        &task.integration_result,
                        Some(IntegrationResult::Merged { .. })
                    );
                if needs_integration {
                    Some(OrchestratorAction::IntegrateDoneTask(task.clone()))
                } else {
                    None
                }
            }
            TaskStatus::Failed | TaskStatus::Blocked => {
                // Terminal states - no action needed
                None
            }
        };

        if let Some(a) = action {
            actions.push(a);
        }
    }

    Ok(actions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_process_running_nonexistent() {
        // PID 999999999 almost certainly doesn't exist
        assert!(!is_process_running(999_999_999));
    }

    #[test]
    fn test_is_process_running_self() {
        // Our own process should be running
        let pid = std::process::id();
        assert!(is_process_running(pid));
    }
}
