//! Orchestrator module - periodically checks task state and spawns agents as needed.
//!
//! This implements a reconciliation loop pattern: instead of spawning agents
//! at every state transition, we periodically check what should be running
//! and start/resume agents as needed.

use crate::domain::{Task, TaskKind, TaskStatus};
use crate::services::Project;
use crate::state::predicates;
use crate::tasks;

/// Represents an action the orchestrator wants to take
#[derive(Debug, Clone)]
pub enum OrchestratorAction {
    /// Spawn a new planner agent for this task
    SpawnPlanner(Task),
    /// Resume planner with user's answers to questions
    ResumePlannerWithAnswers(Task),
    /// Resume planner session (e.g., after plan rejection)
    ResumePlanner { task: Task, session_key: String },
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
    /// Assign a subtask to an existing worker (reuse context)
    /// Used when a subtask depends on another subtask that was just completed
    AssignSubtaskToWorker {
        subtask: Task,
        /// Task ID of the worker that should handle this subtask
        worker_task_id: String,
    },
}

/// Check if task is waiting for human review.
///
/// Delegates to the canonical predicate, fetching the current iteration for
/// accurate fallback during migration.
fn needs_human_review(task: &Task, project: &Project) -> bool {
    use crate::state::NeedsReview;

    // Get the current iteration based on status for accurate fallback
    let store = project.store();
    let current_iter: Option<Box<dyn NeedsReview>> = match task.status {
        TaskStatus::Planning => store
            .get_current_plan_iteration(&task.id)
            .ok()
            .flatten()
            .map(|i| Box::new(i) as Box<dyn NeedsReview>),
        TaskStatus::Working => store
            .get_current_work_iteration(&task.id)
            .ok()
            .flatten()
            .map(|i| Box::new(i) as Box<dyn NeedsReview>),
        TaskStatus::Reviewing => store
            .get_current_review_iteration(&task.id)
            .ok()
            .flatten()
            .map(|i| Box::new(i) as Box<dyn NeedsReview>),
        _ => None,
    };

    predicates::needs_human_review(task, current_iter.as_deref())
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

        // Skip if agent is already running (use canonical predicate)
        if predicates::has_running_agent(&task) {
            continue;
        }

        // Skip if waiting for human review
        if needs_human_review(&task, project) {
            continue;
        }

        // Determine what action is needed based on status
        let action = match task.status {
            TaskStatus::Planning => {
                // Check if the planner has asked questions that have been answered
                // (no pending questions, but has question history and a plan session)
                // Also verify phase is Idle to avoid race conditions
                let has_answered_questions = task.pending_questions.is_empty()
                    && !task.question_history.is_empty()
                    && task.phase == crate::state::TaskPhase::Idle
                    && task
                        .sessions
                        .as_ref()
                        .is_some_and(|s| s.contains_key("plan"));

                if has_answered_questions {
                    // Resume planner with the user's answers
                    Some(OrchestratorAction::ResumePlannerWithAnswers(task.clone()))
                } else if let Some(session_key) = get_resume_session_key(&task) {
                    if session_key == "plan" {
                        // Has a plan session, but agent not running - resume it
                        Some(OrchestratorAction::ResumePlanner {
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
                // Parent is waiting - check for ready subtasks (dependencies satisfied)
                // Subtasks with all dependencies completed can be spawned
                if let Ok(ready_subtasks) = tasks::get_ready_subtasks(project, &task.id) {
                    for subtask in ready_subtasks {
                        // Skip if subtask already has an agent running
                        if predicates::has_running_agent(&subtask) {
                            continue;
                        }

                        // Skip if subtask is not in Working status
                        if subtask.status != TaskStatus::Working {
                            continue;
                        }

                        // Determine worker assignment based on dependencies
                        let worker_action = if subtask.depends_on.is_empty() {
                            // No dependencies - spawn a new worker
                            OrchestratorAction::SpawnWorker(subtask)
                        } else {
                            // Has dependencies - try to reuse worker from first completed dependency
                            let dep_id = &subtask.depends_on[0];
                            if let Ok(Some(dep_task)) = tasks::get_task(project, dep_id) {
                                // Reuse the worker that handled the dependency
                                let worker_id = dep_task
                                    .assigned_worker_task_id
                                    .unwrap_or(dep_task.id);
                                OrchestratorAction::AssignSubtaskToWorker {
                                    subtask,
                                    worker_task_id: worker_id,
                                }
                            } else {
                                // Dependency not found, spawn new worker
                                OrchestratorAction::SpawnWorker(subtask)
                            }
                        };

                        actions.push(worker_action);
                    }
                }
                None
            }
            TaskStatus::Done => {
                // Done tasks may need integration (merge branch, cleanup worktree)
                // Only integrate if the current loop has no outcome yet (first attempt this loop)
                if task.branch_name.is_some() {
                    // Check if current loop is still active (no outcome yet)
                    let needs_integration = project
                        .store()
                        .get_current_loop(&task.id)
                        .ok()
                        .flatten()
                        .is_some_and(|loop_| loop_.outcome.is_none());
                    if needs_integration {
                        Some(OrchestratorAction::IntegrateDoneTask(task.clone()))
                    } else {
                        None
                    }
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
    use crate::state::TaskPhase;

    #[test]
    fn test_has_running_agent_by_phase() {
        let mut task = Task::new(
            "TEST-001".into(),
            Some("Test".into()),
            "Description".into(),
            "2025-01-23T00:00:00Z",
        );

        // Idle phase - not running
        task.phase = TaskPhase::Idle;
        assert!(!predicates::has_running_agent(&task));

        // AgentWorking phase - running
        task.phase = TaskPhase::AgentWorking;
        assert!(predicates::has_running_agent(&task));

        // AwaitingReview phase - not running
        task.phase = TaskPhase::AwaitingReview;
        assert!(!predicates::has_running_agent(&task));
    }

    #[test]
    fn test_has_running_agent_fallback() {
        let mut task = Task::new(
            "TEST-001".into(),
            Some("Test".into()),
            "Description".into(),
            "2025-01-23T00:00:00Z",
        );
        task.phase = TaskPhase::Idle;
        // Set our own PID (which is running)
        task.agent_pid = Some(std::process::id());

        // Fallback check should find running process
        assert!(predicates::has_running_agent(&task));
    }
}
