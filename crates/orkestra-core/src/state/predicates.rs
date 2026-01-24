//! Pure state predicates - SINGLE SOURCE OF TRUTH for state queries.
//!
//! All functions in this module are pure and can be unit tested without mocking.
//! This is the canonical location for all state-checking logic in Orkestra.
//!
//! # Design Principles
//!
//! 1. **Pure functions**: All predicates take data as input and return bool.
//!    No side effects, no database queries.
//!
//! 2. **Single source of truth**: If you need to check state, use these functions.
//!    Do NOT write inline checks like `task.status == Working && task.summary.is_some()`.
//!
//! 3. **Explicit phase**: Prefer checking `task.phase` over inferring from fields.
//!    The phase field is the canonical answer to "what's happening with this task?"

use crate::domain::{
    PlanIteration, ReviewIteration, Task, TaskKind, TaskStatus, WorkIteration, WorkLoop,
};
use crate::state::TaskPhase;

// ============================================================================
// High-level state queries (for orchestrator)
// ============================================================================

/// Does this task need human review before proceeding?
///
/// This is THE canonical check - replaces all scattered implementations.
/// Uses the explicit `phase` field when set, falls back to iteration/field checks
/// during migration.
pub fn needs_human_review(task: &Task, current_iter: Option<&dyn NeedsReview>) -> bool {
    // Primary: check explicit phase
    if task.phase == TaskPhase::AwaitingReview {
        return true;
    }

    // Fallback during migration: check iteration or fields
    if task.phase == TaskPhase::Idle {
        if let Some(iter) = current_iter {
            return iter.needs_review();
        }
        // Legacy fallback - check fields
        return match task.status {
            TaskStatus::Planning => task.plan.is_some(),
            TaskStatus::BreakingDown => task.breakdown.is_some(),
            TaskStatus::Working => task.summary.is_some(),
            _ => false,
        };
    }

    false
}

/// Simplified check using just the task's phase field.
/// Use this when you know phases are properly set.
pub fn needs_human_review_by_phase(task: &Task) -> bool {
    task.phase == TaskPhase::AwaitingReview
}

/// Does this task have a running agent process?
///
/// Uses the explicit `phase` field when set, falls back to `agent_pid` check
/// during migration.
pub fn has_running_agent(task: &Task) -> bool {
    // Primary: check explicit phase
    if task.phase == TaskPhase::AgentWorking {
        return true;
    }

    // Fallback during migration: check pid
    if task.phase == TaskPhase::Idle {
        if let Some(pid) = task.agent_pid {
            return is_process_running(pid);
        }
    }

    false
}

/// Simplified check using just the task's phase field.
/// Use this when you know phases are properly set.
pub fn has_running_agent_by_phase(task: &Task) -> bool {
    task.phase == TaskPhase::AgentWorking
}

/// Is this task in a terminal state?
pub fn is_terminal(task: &Task) -> bool {
    matches!(
        task.status,
        TaskStatus::Done | TaskStatus::Failed | TaskStatus::Blocked
    )
}

/// Should this task be skipped by the orchestrator?
/// (Subtasks don't get their own agents - parent task handles them)
pub fn should_skip_orchestration(task: &Task) -> bool {
    task.kind == TaskKind::Subtask
}

// ============================================================================
// Transition preconditions (for tasks.rs functions)
// ============================================================================

/// Can this task's plan be approved?
pub fn can_approve_plan(task: &Task, current_iter: Option<&PlanIteration>) -> bool {
    if task.status != TaskStatus::Planning {
        return false;
    }

    // Check phase if set
    if task.phase != TaskPhase::Idle && task.phase != TaskPhase::AwaitingReview {
        return false;
    }

    // Check iteration if available
    if let Some(iter) = current_iter {
        iter.needs_review()
    } else {
        // Legacy fallback
        task.plan.is_some()
    }
}

/// Can this task's plan be rejected (requesting changes)?
pub fn can_reject_plan(task: &Task, current_iter: Option<&PlanIteration>) -> bool {
    // Same preconditions as approval
    can_approve_plan(task, current_iter)
}

/// Can this task's work be approved (either to Done or to Review)?
pub fn can_approve_work(task: &Task, current_iter: Option<&WorkIteration>) -> bool {
    if task.status != TaskStatus::Working {
        return false;
    }

    // Check phase if set
    if task.phase != TaskPhase::Idle && task.phase != TaskPhase::AwaitingReview {
        return false;
    }

    // Check iteration if available
    if let Some(iter) = current_iter {
        iter.needs_review()
    } else {
        // Legacy fallback
        task.summary.is_some()
    }
}

/// Can this task be sent to automated review?
pub fn can_start_review(task: &Task, current_iter: Option<&WorkIteration>) -> bool {
    can_approve_work(task, current_iter)
}

/// Can this task's work be rejected (requesting changes)?
pub fn can_reject_work(task: &Task, current_iter: Option<&WorkIteration>) -> bool {
    can_approve_work(task, current_iter)
}

/// Can this task's breakdown be approved?
pub fn can_approve_breakdown(task: &Task) -> bool {
    if task.status != TaskStatus::BreakingDown {
        return false;
    }

    // Check phase if set
    if task.phase != TaskPhase::Idle && task.phase != TaskPhase::AwaitingReview {
        return false;
    }

    task.breakdown.is_some()
}

/// Can this task's breakdown be rejected?
pub fn can_reject_breakdown(task: &Task) -> bool {
    can_approve_breakdown(task)
}

/// Can this task's breakdown be skipped (proceed to Working without subtasks)?
pub fn can_skip_breakdown(task: &Task) -> bool {
    task.status == TaskStatus::BreakingDown
}

/// Can this task's review verdict be approved?
pub fn can_approve_review(task: &Task, current_iter: Option<&ReviewIteration>) -> bool {
    if task.status != TaskStatus::Reviewing {
        return false;
    }

    // Check phase if set
    if task.phase != TaskPhase::Idle && task.phase != TaskPhase::AwaitingReview {
        return false;
    }

    // Check iteration if available
    if let Some(iter) = current_iter {
        iter.needs_review()
    } else {
        // Legacy fallback - just check status
        true
    }
}

/// Can this task's review verdict be rejected?
pub fn can_reject_review(task: &Task, current_iter: Option<&ReviewIteration>) -> bool {
    can_approve_review(task, current_iter)
}

// ============================================================================
// Integration predicates
// ============================================================================

/// Does this Done task need integration (merge branch, cleanup worktree)?
pub fn needs_integration(task: &Task, current_loop: Option<&WorkLoop>) -> bool {
    task.status == TaskStatus::Done
        && task.branch_name.is_some()
        && current_loop.is_some_and(|l| l.outcome.is_none())
}

/// Is this task currently being integrated?
pub fn is_integrating(task: &Task) -> bool {
    task.phase == TaskPhase::Integrating
}

// ============================================================================
// Agent spawning decisions
// ============================================================================

/// Should we spawn/resume a planner agent?
pub fn should_spawn_planner(task: &Task) -> bool {
    task.status == TaskStatus::Planning
        && task.phase != TaskPhase::AwaitingReview
        && task.phase != TaskPhase::AgentWorking
}

/// Should we spawn/resume a breakdown agent?
pub fn should_spawn_breakdown(task: &Task) -> bool {
    task.status == TaskStatus::BreakingDown
        && task.phase != TaskPhase::AwaitingReview
        && task.phase != TaskPhase::AgentWorking
}

/// Should we spawn/resume a worker agent?
pub fn should_spawn_worker(task: &Task) -> bool {
    task.status == TaskStatus::Working
        && task.phase != TaskPhase::AwaitingReview
        && task.phase != TaskPhase::AgentWorking
}

/// Should we spawn/resume a reviewer agent?
pub fn should_spawn_reviewer(task: &Task) -> bool {
    task.status == TaskStatus::Reviewing
        && task.phase != TaskPhase::AwaitingReview
        && task.phase != TaskPhase::AgentWorking
}

// ============================================================================
// Trait for iteration types
// ============================================================================

/// Trait implemented by iteration types that can need review.
pub trait NeedsReview {
    fn needs_review(&self) -> bool;
}

impl NeedsReview for PlanIteration {
    fn needs_review(&self) -> bool {
        self.plan.is_some() && self.outcome.is_none()
    }
}

impl NeedsReview for WorkIteration {
    fn needs_review(&self) -> bool {
        self.summary.is_some() && self.outcome.is_none()
    }
}

impl NeedsReview for ReviewIteration {
    fn needs_review(&self) -> bool {
        self.verdict.is_some() && self.outcome.is_none()
    }
}

// ============================================================================
// Process helpers
// ============================================================================

/// Check if a process with the given PID is still running.
///
/// On Unix, uses `kill(pid, 0)` which checks if the process exists without sending a signal.
/// On Windows, uses `OpenProcess` to check if the process handle can be opened.
#[allow(clippy::cast_possible_wrap)] // PIDs won't exceed i32::MAX in practice
pub fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // On Unix, kill with signal 0 checks if process exists without killing it
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        // On Windows, try to open the process
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_task() -> Task {
        Task::new(
            "TEST-001".to_string(),
            Some("Test".to_string()),
            "Description".to_string(),
            "2025-01-23T00:00:00Z",
        )
    }

    // ========================================================================
    // needs_human_review tests
    // ========================================================================

    #[test]
    fn test_needs_human_review_by_phase() {
        let mut task = make_task();

        // Idle phase - not awaiting review
        task.phase = TaskPhase::Idle;
        assert!(!needs_human_review_by_phase(&task));

        // AgentWorking - not awaiting review
        task.phase = TaskPhase::AgentWorking;
        assert!(!needs_human_review_by_phase(&task));

        // AwaitingReview - yes
        task.phase = TaskPhase::AwaitingReview;
        assert!(needs_human_review_by_phase(&task));

        // Integrating - not awaiting review
        task.phase = TaskPhase::Integrating;
        assert!(!needs_human_review_by_phase(&task));
    }

    #[test]
    fn test_needs_human_review_with_iteration() {
        let mut task = make_task();
        task.status = TaskStatus::Planning;
        task.phase = TaskPhase::Idle;

        // No plan in iteration
        let iter = PlanIteration::new(1, "now");
        assert!(!needs_human_review(&task, Some(&iter)));

        // Plan set in iteration
        let mut iter_with_plan = PlanIteration::new(1, "now");
        iter_with_plan.plan = Some("The plan".to_string());
        assert!(needs_human_review(&task, Some(&iter_with_plan)));
    }

    #[test]
    fn test_needs_human_review_legacy_fallback() {
        let mut task = make_task();
        task.status = TaskStatus::Planning;
        task.phase = TaskPhase::Idle;

        // No plan
        let none_iter: Option<&dyn NeedsReview> = None;
        assert!(!needs_human_review(&task, none_iter));

        // Has plan
        task.plan = Some("The plan".to_string());
        assert!(needs_human_review(&task, none_iter));
    }

    // ========================================================================
    // has_running_agent tests
    // ========================================================================

    #[test]
    fn test_has_running_agent_by_phase() {
        let mut task = make_task();

        task.phase = TaskPhase::Idle;
        assert!(!has_running_agent_by_phase(&task));

        task.phase = TaskPhase::AgentWorking;
        assert!(has_running_agent_by_phase(&task));
    }

    #[test]
    fn test_has_running_agent_fallback() {
        let mut task = make_task();
        task.phase = TaskPhase::Idle;
        task.agent_pid = Some(std::process::id()); // Our own PID is running

        assert!(has_running_agent(&task));
    }

    // ========================================================================
    // Terminal state tests
    // ========================================================================

    #[test]
    fn test_is_terminal() {
        let mut task = make_task();

        task.status = TaskStatus::Planning;
        assert!(!is_terminal(&task));

        task.status = TaskStatus::Working;
        assert!(!is_terminal(&task));

        task.status = TaskStatus::Done;
        assert!(is_terminal(&task));

        task.status = TaskStatus::Failed;
        assert!(is_terminal(&task));

        task.status = TaskStatus::Blocked;
        assert!(is_terminal(&task));
    }

    // ========================================================================
    // Approval precondition tests
    // ========================================================================

    #[test]
    fn test_can_approve_plan() {
        let mut task = make_task();
        task.status = TaskStatus::Planning;
        task.phase = TaskPhase::AwaitingReview;
        task.plan = Some("plan".to_string());

        assert!(can_approve_plan(&task, None));

        // Wrong status
        task.status = TaskStatus::Working;
        assert!(!can_approve_plan(&task, None));

        // Wrong phase (agent still working)
        task.status = TaskStatus::Planning;
        task.phase = TaskPhase::AgentWorking;
        assert!(!can_approve_plan(&task, None));

        // No plan
        task.phase = TaskPhase::AwaitingReview;
        task.plan = None;
        assert!(!can_approve_plan(&task, None));
    }

    #[test]
    fn test_can_approve_work() {
        let mut task = make_task();
        task.status = TaskStatus::Working;
        task.phase = TaskPhase::AwaitingReview;
        task.summary = Some("done".to_string());

        assert!(can_approve_work(&task, None));

        // Wrong status
        task.status = TaskStatus::Planning;
        assert!(!can_approve_work(&task, None));
    }

    #[test]
    fn test_can_approve_breakdown() {
        let mut task = make_task();
        task.status = TaskStatus::BreakingDown;
        task.phase = TaskPhase::AwaitingReview;
        task.breakdown = Some("breakdown".to_string());

        assert!(can_approve_breakdown(&task));

        // No breakdown
        task.breakdown = None;
        assert!(!can_approve_breakdown(&task));
    }

    // ========================================================================
    // Integration tests
    // ========================================================================

    #[test]
    fn test_needs_integration() {
        let mut task = make_task();
        task.status = TaskStatus::Done;
        task.branch_name = Some("task/TEST-001".to_string());

        // With active loop
        let loop_ = WorkLoop::new(1, TaskStatus::Working, "now");
        assert!(needs_integration(&task, Some(&loop_)));

        // No branch
        task.branch_name = None;
        assert!(!needs_integration(&task, Some(&loop_)));

        // Wrong status
        task.branch_name = Some("task/TEST-001".to_string());
        task.status = TaskStatus::Working;
        assert!(!needs_integration(&task, Some(&loop_)));
    }

    // ========================================================================
    // Spawning decision tests
    // ========================================================================

    #[test]
    fn test_should_spawn_planner() {
        let mut task = make_task();
        task.status = TaskStatus::Planning;
        task.phase = TaskPhase::Idle;

        assert!(should_spawn_planner(&task));

        // Don't spawn if awaiting review
        task.phase = TaskPhase::AwaitingReview;
        assert!(!should_spawn_planner(&task));

        // Don't spawn if agent already working
        task.phase = TaskPhase::AgentWorking;
        assert!(!should_spawn_planner(&task));
    }

    #[test]
    fn test_should_spawn_worker() {
        let mut task = make_task();
        task.status = TaskStatus::Working;
        task.phase = TaskPhase::Idle;

        assert!(should_spawn_worker(&task));

        task.status = TaskStatus::Planning;
        assert!(!should_spawn_worker(&task));
    }
}
