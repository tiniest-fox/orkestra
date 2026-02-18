//! Rich task view for API responses.
//!
//! `TaskView` combines a task with pre-joined data (iterations, stage sessions)
//! and a `DerivedTaskState` computed from domain predicates. This lets the frontend
//! be a thin render layer — all business logic lives in the Rust domain model.

use serde::{Deserialize, Serialize};

use crate::workflow::domain::{Iteration, Question, StageSession, Task};
use crate::workflow::runtime::{Outcome, TaskState};

/// A task with pre-joined data and derived state for the frontend.
///
/// This is the API response type — the internal `Task` struct stays lean.
/// Uses `#[serde(flatten)]` so JSON includes task fields at the top level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskView {
    #[serde(flatten)]
    pub task: Task,
    pub iterations: Vec<Iteration>,
    pub stage_sessions: Vec<StageSession>,
    pub derived: DerivedTaskState,
}

/// Pre-computed state derived from task + iterations + sessions.
///
/// Centralizes business logic in the backend so the frontend
/// is a thin render layer. Each field delegates to canonical
/// predicates on `TaskState` — no duplicated logic.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerivedTaskState {
    pub current_stage: Option<String>,
    pub is_working: bool,
    pub is_system_active: bool,
    pub phase_icon: Option<String>,
    pub is_interrupted: bool,
    pub is_failed: bool,
    pub is_blocked: bool,
    pub is_done: bool,
    pub is_archived: bool,
    pub is_terminal: bool,
    pub is_waiting_on_children: bool,
    pub needs_review: bool,
    pub has_questions: bool,
    pub pending_questions: Vec<Question>,
    pub rejection_feedback: Option<String>,
    pub pending_rejection: Option<PendingRejection>,
    pub stages_with_logs: Vec<StageLogInfo>,
    pub subtask_progress: Option<SubtaskProgress>,
}

/// A pending rejection from a reviewer agent awaiting human confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingRejection {
    /// The stage that produced the rejection (e.g., "review").
    pub from_stage: String,
    /// The target stage the rejection would send work to (e.g., "work").
    pub target: String,
    /// The agent's rejection feedback.
    pub feedback: String,
}

/// Progress summary for a parent task's subtasks.
///
/// Per-state counts mirror the primary task states so the frontend
/// can render a segment per state in the progress bar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtaskProgress {
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub blocked: usize,
    pub interrupted: usize,
    pub has_questions: usize,
    pub needs_review: usize,
    pub working: usize,
    /// Idle/waiting — not in any of the above states.
    pub waiting: usize,
}

/// Information about a single session within a stage for log display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionLogInfo {
    /// The unique session ID (UUID).
    pub session_id: String,
    /// The run number within this stage (1-indexed, ordered by created_at).
    pub run_number: u32,
    /// Whether this is the current (non-superseded) session.
    pub is_current: bool,
    /// When this session was created (RFC3339).
    pub created_at: String,
}

/// Information about a stage's log sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageLogInfo {
    /// The stage name.
    pub stage: String,
    /// All sessions for this stage that have logs, ordered chronologically.
    pub sessions: Vec<SessionLogInfo>,
}

impl DerivedTaskState {
    /// Build derived state from a task and its related data.
    ///
    /// Delegates to Task/Status/Phase predicates — one canonical definition per predicate.
    /// `subtask_states` should be the pre-computed derived states of child tasks (if any).
    pub fn build(
        task: &Task,
        iterations: &[Iteration],
        sessions: &[StageSession],
        subtask_states: &[DerivedTaskState],
    ) -> Self {
        let pending_questions = extract_pending_questions(task, iterations);
        let rejection_feedback = extract_rejection_feedback(task, iterations);
        let pending_rejection = extract_pending_rejection(task, iterations);
        let stages_with_logs = build_stages_with_logs(sessions);
        let subtask_progress = compute_subtask_progress(subtask_states);

        Self {
            current_stage: task.current_stage().map(str::to_string),
            is_working: !task.is_terminal() && task.state.has_active_agent(),
            is_system_active: !task.is_terminal() && task.state.is_system_active(),
            phase_icon: compute_phase_icon(task),
            is_interrupted: matches!(task.state, TaskState::Interrupted { .. }),
            is_failed: task.is_failed(),
            is_blocked: task.is_blocked(),
            is_done: task.is_done(),
            is_archived: task.is_archived(),
            is_terminal: task.is_terminal(),
            is_waiting_on_children: task.state.is_waiting_on_children(),
            needs_review: task.needs_review(),
            has_questions: !pending_questions.is_empty(),
            pending_questions,
            rejection_feedback,
            pending_rejection,
            stages_with_logs,
            subtask_progress,
        }
    }
}

/// Build grouped stage log info from sessions.
///
/// Groups sessions by stage name, orders by created_at within each group,
/// and assigns run numbers (1-indexed). Includes all sessions regardless of state
/// since any session could have logs.
fn build_stages_with_logs(sessions: &[StageSession]) -> Vec<StageLogInfo> {
    use std::collections::HashMap;

    use crate::workflow::domain::SessionState;

    // Group sessions by stage
    let mut by_stage: HashMap<String, Vec<&StageSession>> = HashMap::new();
    for session in sessions {
        by_stage
            .entry(session.stage.clone())
            .or_default()
            .push(session);
    }

    // Convert to StageLogInfo, sorted by earliest session per stage
    let mut result: Vec<StageLogInfo> = by_stage
        .into_iter()
        .map(|(stage, mut sessions_for_stage)| {
            // Sort by created_at ascending
            sessions_for_stage.sort_by(|a, b| a.created_at.cmp(&b.created_at));

            let sessions = sessions_for_stage
                .into_iter()
                .enumerate()
                .map(|(idx, s)| SessionLogInfo {
                    session_id: s.id.clone(),
                    run_number: (idx + 1) as u32,
                    is_current: s.session_state != SessionState::Superseded,
                    created_at: s.created_at.clone(),
                })
                .collect();

            StageLogInfo { stage, sessions }
        })
        .collect();

    // Sort stages by their first session's created_at
    result.sort_by(|a, b| {
        let a_first = a.sessions.first().map(|s| &s.created_at);
        let b_first = b.sessions.first().map(|s| &s.created_at);
        a_first.cmp(&b_first)
    });

    result
}

/// Compute subtask progress from pre-computed subtask derived states.
///
/// Returns `None` if the list is empty (task has no children).
/// States are checked in priority order — each subtask is counted in exactly one bucket.
fn compute_subtask_progress(subtask_states: &[DerivedTaskState]) -> Option<SubtaskProgress> {
    if subtask_states.is_empty() {
        return None;
    }

    let mut progress = SubtaskProgress {
        total: subtask_states.len(),
        done: 0,
        failed: 0,
        blocked: 0,
        interrupted: 0,
        has_questions: 0,
        needs_review: 0,
        working: 0,
        waiting: 0,
    };

    for s in subtask_states {
        // Count Done and Archived subtasks as completed
        if s.is_done || s.is_archived {
            progress.done += 1;
        } else if s.is_failed {
            progress.failed += 1;
        } else if s.is_blocked {
            progress.blocked += 1;
        } else if s.is_interrupted {
            progress.interrupted += 1;
        } else if s.has_questions {
            progress.has_questions += 1;
        } else if s.needs_review {
            progress.needs_review += 1;
        } else if s.is_working || s.is_system_active {
            progress.working += 1;
        } else {
            progress.waiting += 1;
        }
    }

    Some(progress)
}

/// Compute the phase icon hint for the frontend.
///
/// Returns a string tag that the frontend maps to a specific icon.
/// Returns `None` when no phase-specific icon should be shown
/// (e.g., terminal tasks, agent working, awaiting review).
fn compute_phase_icon(task: &Task) -> Option<String> {
    if task.is_terminal() {
        return None;
    }
    match &task.state {
        TaskState::Committing { .. } => Some("committing".to_string()),
        TaskState::Integrating => Some("integrating".to_string()),
        TaskState::SettingUp { .. } => Some("setting_up".to_string()),
        TaskState::AwaitingSetup { .. } => Some("awaiting_setup".to_string()),
        TaskState::Finishing { .. } | TaskState::Committed { .. } => {
            Some("system_busy".to_string())
        }
        TaskState::Queued { .. } => Some("waiting_for_orchestrator".to_string()),
        // Human-facing, agent-active, parent, and terminal states don't show phase icons
        TaskState::AgentWorking { .. }
        | TaskState::AwaitingApproval { .. }
        | TaskState::AwaitingQuestionAnswer { .. }
        | TaskState::AwaitingRejectionConfirmation { .. }
        | TaskState::Interrupted { .. }
        | TaskState::WaitingOnChildren { .. }
        | TaskState::Done
        | TaskState::Archived
        | TaskState::Failed { .. }
        | TaskState::Blocked { .. } => None,
    }
}

/// Extract pending questions from the latest iteration of the current stage.
///
/// Same logic as `WorkflowApi::get_pending_questions()` but takes data as input
/// rather than querying the store.
fn extract_pending_questions(task: &Task, iterations: &[Iteration]) -> Vec<Question> {
    let Some(stage) = task.current_stage() else {
        return vec![];
    };

    // Find the latest iteration for the current stage
    let latest = iterations
        .iter()
        .filter(|i| i.stage == stage)
        .max_by_key(|i| i.iteration_number);

    if let Some(iter) = latest {
        if let Some(Outcome::AwaitingAnswers { questions, .. }) = &iter.outcome {
            return questions.clone();
        }
    }

    vec![]
}

/// Extract rejection feedback from the latest iteration of the current stage.
///
/// Same logic as `WorkflowApi::get_rejection_feedback()` but takes data as input.
fn extract_rejection_feedback(task: &Task, iterations: &[Iteration]) -> Option<String> {
    let stage = task.current_stage()?;

    // Find the most recent rejection outcome for this stage
    let stage_iterations: Vec<_> = iterations.iter().filter(|i| i.stage == stage).collect();

    for iteration in stage_iterations.into_iter().rev() {
        if let Some(Outcome::Rejected { feedback, .. } | Outcome::Rejection { feedback, .. }) =
            &iteration.outcome
        {
            return Some(feedback.clone());
        }
    }

    None
}

/// Extract a pending rejection from the latest iteration of the current stage.
///
/// Returns `Some(PendingRejection)` if the latest iteration ended with `AwaitingRejectionReview`.
fn extract_pending_rejection(task: &Task, iterations: &[Iteration]) -> Option<PendingRejection> {
    let stage = task.current_stage()?;

    let latest = iterations
        .iter()
        .filter(|i| i.stage == stage)
        .max_by_key(|i| i.iteration_number);

    if let Some(iter) = latest {
        if let Some(Outcome::AwaitingRejectionReview {
            from_stage,
            target,
            feedback,
        }) = &iter.outcome
        {
            return Some(PendingRejection {
                from_stage: from_stage.clone(),
                target: target.clone(),
                feedback: feedback.clone(),
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::{Question, SessionState};
    use crate::workflow::runtime::TaskState;

    fn make_task(stage: &str) -> Task {
        Task::new(
            "task-1",
            "Test",
            "Description",
            stage,
            "2025-01-24T10:00:00Z",
        )
    }

    #[test]
    fn test_derived_state_active_task() {
        let task = make_task("planning");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(derived.current_stage, Some("planning".to_string()));
        assert!(!derived.is_working);
        assert!(!derived.is_failed);
        assert!(!derived.is_blocked);
        assert!(!derived.is_done);
        assert!(!derived.is_terminal);
        assert!(!derived.needs_review);
        assert!(!derived.has_questions);
        assert!(derived.pending_questions.is_empty());
        assert!(derived.rejection_feedback.is_none());
        assert!(derived.stages_with_logs.is_empty());
    }

    #[test]
    fn test_derived_state_working() {
        let mut task = make_task("planning");
        task.state = TaskState::agent_working("planning");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.is_working);
        assert!(!derived.needs_review);
    }

    #[test]
    fn test_derived_state_needs_review() {
        let mut task = make_task("planning");
        task.state = TaskState::awaiting_approval("planning");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.needs_review);
        assert!(!derived.is_working);
    }

    #[test]
    fn test_derived_state_done_not_needs_review() {
        let mut task = make_task("planning");
        task.state = TaskState::Done;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        // Done tasks should not count as needs_review
        assert!(!derived.needs_review);
    }

    #[test]
    fn test_derived_state_terminal_states() {
        let mut task = make_task("planning");

        task.state = TaskState::Done;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(derived.is_done);
        assert!(derived.is_terminal);
        assert!(derived.current_stage.is_none());

        task.state = TaskState::failed("error");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(derived.is_failed);
        assert!(derived.is_terminal);

        task.state = TaskState::blocked("reason");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(derived.is_blocked);
        assert!(derived.is_terminal);
    }

    #[test]
    fn test_derived_state_with_questions() {
        let task = make_task("planning");
        let mut iter = Iteration::new("iter-1", "task-1", "planning", 1, "now");
        iter.outcome = Some(Outcome::awaiting_answers(
            "planning",
            vec![Question::new("What framework?")],
        ));
        iter.ended_at = Some("now".to_string());

        let derived = DerivedTaskState::build(&task, &[iter], &[], &[]);

        assert!(derived.has_questions);
        assert_eq!(derived.pending_questions.len(), 1);
        assert_eq!(derived.pending_questions[0].question, "What framework?");
    }

    #[test]
    fn test_derived_state_with_rejection_feedback() {
        let task = make_task("planning");
        let mut iter = Iteration::new("iter-1", "task-1", "planning", 1, "now");
        iter.outcome = Some(Outcome::rejected("planning", "Needs more detail"));
        iter.ended_at = Some("now".to_string());

        let derived = DerivedTaskState::build(&task, &[iter], &[], &[]);

        assert_eq!(
            derived.rejection_feedback,
            Some("Needs more detail".to_string())
        );
    }

    #[test]
    fn test_derived_state_stages_with_logs() {
        let task = make_task("planning");

        let mut session1 =
            StageSession::new("ss-1", "task-1", "planning", "2025-01-24T10:00:00Z");
        session1.session_state = SessionState::Active;

        let mut session2 = StageSession::new("ss-2", "task-1", "work", "2025-01-24T11:00:00Z");
        session2.session_state = SessionState::Spawning;

        let derived = DerivedTaskState::build(&task, &[], &[session1, session2], &[]);

        // All sessions produce tabs, including Spawning
        assert_eq!(derived.stages_with_logs.len(), 2);
        assert_eq!(derived.stages_with_logs[0].stage, "planning");
        assert_eq!(derived.stages_with_logs[0].sessions.len(), 1);
        assert_eq!(derived.stages_with_logs[0].sessions[0].run_number, 1);
        assert!(derived.stages_with_logs[0].sessions[0].is_current);
        assert_eq!(derived.stages_with_logs[1].stage, "work");
    }

    #[test]
    fn test_derived_state_multiple_sessions_per_stage() {
        let task = make_task("work");

        // First review session - superseded
        let mut session1 =
            StageSession::new("ss-1", "task-1", "review", "2025-01-24T10:00:00Z");
        session1.session_state = SessionState::Superseded;

        // Second review session - current
        let mut session2 =
            StageSession::new("ss-2", "task-1", "review", "2025-01-24T11:00:00Z");
        session2.session_state = SessionState::Active;

        // Work session
        let mut session3 = StageSession::new("ss-3", "task-1", "work", "2025-01-24T09:00:00Z");
        session3.session_state = SessionState::Completed;

        let derived = DerivedTaskState::build(&task, &[], &[session1, session2, session3], &[]);

        // Should have 2 stages: work (first by created_at), then review
        assert_eq!(derived.stages_with_logs.len(), 2);

        // Work stage comes first (09:00)
        assert_eq!(derived.stages_with_logs[0].stage, "work");
        assert_eq!(derived.stages_with_logs[0].sessions.len(), 1);

        // Review stage has 2 sessions
        assert_eq!(derived.stages_with_logs[1].stage, "review");
        assert_eq!(derived.stages_with_logs[1].sessions.len(), 2);

        // Sessions are ordered chronologically with correct run numbers
        assert_eq!(derived.stages_with_logs[1].sessions[0].run_number, 1);
        assert_eq!(derived.stages_with_logs[1].sessions[0].session_id, "ss-1");
        assert!(!derived.stages_with_logs[1].sessions[0].is_current); // superseded

        assert_eq!(derived.stages_with_logs[1].sessions[1].run_number, 2);
        assert_eq!(derived.stages_with_logs[1].sessions[1].session_id, "ss-2");
        assert!(derived.stages_with_logs[1].sessions[1].is_current); // active
    }

    #[test]
    fn test_derived_state_questions_only_from_current_stage() {
        let task = make_task("work");

        // Questions from a different stage should be ignored
        let mut iter = Iteration::new("iter-1", "task-1", "planning", 1, "now");
        iter.outcome = Some(Outcome::awaiting_answers(
            "planning",
            vec![Question::new("Old question?")],
        ));
        iter.ended_at = Some("now".to_string());

        let derived = DerivedTaskState::build(&task, &[iter], &[], &[]);

        assert!(!derived.has_questions);
        assert!(derived.pending_questions.is_empty());
    }

    #[test]
    fn test_derived_state_no_subtasks() {
        let task = make_task("planning");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.subtask_progress.is_none());
        assert!(!derived.is_waiting_on_children);
    }

    #[test]
    fn test_derived_state_with_subtask_progress() {
        let mut parent = make_task("breakdown");
        parent.state = TaskState::waiting_on_children("work");

        // Build derived states for subtasks
        let mut sub1 = Task::new("sub-1", "Sub 1", "Desc", "work", "now");
        sub1.state = TaskState::Done;
        let sub1_derived = DerivedTaskState::build(&sub1, &[], &[], &[]);

        let sub2 = Task::new("sub-2", "Sub 2", "Desc", "work", "now");
        let sub2_derived = DerivedTaskState::build(&sub2, &[], &[], &[]);

        let mut sub3 = Task::new("sub-3", "Sub 3", "Desc", "work", "now");
        sub3.state = TaskState::failed("error");
        let sub3_derived = DerivedTaskState::build(&sub3, &[], &[], &[]);

        let derived = DerivedTaskState::build(
            &parent,
            &[],
            &[],
            &[sub1_derived, sub2_derived, sub3_derived],
        );

        assert!(derived.is_waiting_on_children);
        let progress = derived.subtask_progress.unwrap();
        assert_eq!(progress.total, 3);
        assert_eq!(progress.done, 1);
        assert_eq!(progress.failed, 1);
        assert_eq!(progress.waiting, 1);
        assert_eq!(progress.has_questions, 0);
        assert_eq!(progress.needs_review, 0);
        assert_eq!(progress.working, 0);
        assert_eq!(progress.blocked, 0);
    }

    #[test]
    fn test_subtask_progress_aggregate_flags() {
        let mut parent = make_task("breakdown");
        parent.state = TaskState::waiting_on_children("work");

        // Subtask with questions
        let sub_q = Task::new("sub-q", "Q", "Desc", "work", "now");
        let mut iter_q = Iteration::new("iter-q", "sub-q", "work", 1, "now");
        iter_q.outcome = Some(Outcome::awaiting_answers(
            "work",
            vec![Question::new("How?")],
        ));
        iter_q.ended_at = Some("now".to_string());
        let derived_questions = DerivedTaskState::build(&sub_q, &[iter_q], &[], &[]);

        // Subtask awaiting review
        let mut sub_r = Task::new("sub-r", "R", "Desc", "work", "now");
        sub_r.state = TaskState::awaiting_approval("work");
        let derived_review = DerivedTaskState::build(&sub_r, &[], &[], &[]);

        // Subtask working
        let mut sub_w = Task::new("sub-w", "W", "Desc", "work", "now");
        sub_w.state = TaskState::agent_working("work");
        let derived_working = DerivedTaskState::build(&sub_w, &[], &[], &[]);

        let derived = DerivedTaskState::build(
            &parent,
            &[],
            &[],
            &[derived_questions, derived_review, derived_working],
        );

        let progress = derived.subtask_progress.unwrap();
        assert_eq!(progress.has_questions, 1);
        assert_eq!(progress.needs_review, 1);
        assert_eq!(progress.working, 1);
    }

    #[test]
    fn test_subtask_progress_includes_archived() {
        let mut parent = make_task("breakdown");
        parent.state = TaskState::waiting_on_children("work");

        // Done subtask
        let mut sub1 = Task::new("sub-1", "Sub 1", "Desc", "work", "now");
        sub1.state = TaskState::Done;
        let sub1_derived = DerivedTaskState::build(&sub1, &[], &[], &[]);

        // Archived subtask (completed and integrated)
        let mut sub2 = Task::new("sub-2", "Sub 2", "Desc", "work", "now");
        sub2.state = TaskState::Archived;
        let sub2_derived = DerivedTaskState::build(&sub2, &[], &[], &[]);

        // Active subtask
        let sub3 = Task::new("sub-3", "Sub 3", "Desc", "work", "now");
        let sub3_derived = DerivedTaskState::build(&sub3, &[], &[], &[]);

        let derived = DerivedTaskState::build(
            &parent,
            &[],
            &[],
            &[sub1_derived, sub2_derived, sub3_derived],
        );

        assert!(derived.is_waiting_on_children);
        let progress = derived.subtask_progress.unwrap();
        assert_eq!(progress.total, 3);
        assert_eq!(
            progress.done, 2,
            "Both Done and Archived should count as done"
        );
        assert_eq!(progress.waiting, 1);
    }

    #[test]
    fn test_derived_state_archived() {
        let mut task = make_task("work");
        task.state = TaskState::Archived;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.is_archived);
        assert!(derived.is_terminal);
        assert!(!derived.is_done);
        assert!(!derived.is_failed);
        assert!(!derived.is_blocked);
    }

    #[test]
    fn test_derived_state_pending_rejection() {
        let mut task = make_task("review");
        task.state = TaskState::awaiting_rejection_confirmation("review");

        let mut iter = Iteration::new("iter-1", "task-1", "review", 1, "now");
        iter.outcome = Some(Outcome::awaiting_rejection_review(
            "review",
            "work",
            "Tests are failing",
        ));
        iter.ended_at = Some("now".to_string());

        let derived = DerivedTaskState::build(&task, &[iter], &[], &[]);

        assert!(derived.needs_review);
        let rejection = derived.pending_rejection.unwrap();
        assert_eq!(rejection.from_stage, "review");
        assert_eq!(rejection.target, "work");
        assert_eq!(rejection.feedback, "Tests are failing");
    }

    #[test]
    fn test_derived_state_no_pending_rejection_for_standard_review() {
        let mut task = make_task("review");
        task.state = TaskState::awaiting_approval("review");

        // Standard approval — no pending rejection
        let iter = Iteration::new("iter-1", "task-1", "review", 1, "now");
        let derived = DerivedTaskState::build(&task, &[iter], &[], &[]);

        assert!(derived.pending_rejection.is_none());
    }

    #[test]
    fn test_task_view_serialization() {
        let task = make_task("planning");
        let view = TaskView {
            task: task.clone(),
            iterations: vec![],
            stage_sessions: vec![],
            derived: DerivedTaskState::build(&task, &[], &[], &[]),
        };

        let json = serde_json::to_string(&view).unwrap();
        // Task fields should be flattened to top level
        assert!(json.contains("\"id\":\"task-1\""));
        assert!(json.contains("\"title\":\"Test\""));
        // Derived state should be nested
        assert!(json.contains("\"derived\""));
        assert!(json.contains("\"current_stage\":\"planning\""));
    }

    #[test]
    fn test_derived_state_interrupted() {
        let mut task = make_task("work");
        task.state = TaskState::interrupted("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.is_interrupted);
        assert!(!derived.is_working);
        assert!(!derived.is_failed);
        assert!(!derived.is_blocked);
        assert!(!derived.is_done);
        assert!(!derived.needs_review);
    }

    #[test]
    fn test_subtask_progress_interrupted() {
        let mut parent = make_task("breakdown");
        parent.state = TaskState::waiting_on_children("work");

        // One interrupted subtask
        let mut sub1 = Task::new("sub-1", "Sub 1", "Desc", "work", "now");
        sub1.state = TaskState::interrupted("work");
        let sub1_derived = DerivedTaskState::build(&sub1, &[], &[], &[]);

        // One working subtask
        let mut sub2 = Task::new("sub-2", "Sub 2", "Desc", "work", "now");
        sub2.state = TaskState::agent_working("work");
        let sub2_derived = DerivedTaskState::build(&sub2, &[], &[], &[]);

        // One blocked subtask
        let mut sub3 = Task::new("sub-3", "Sub 3", "Desc", "work", "now");
        sub3.state = TaskState::blocked("waiting");
        let sub3_derived = DerivedTaskState::build(&sub3, &[], &[], &[]);

        let derived = DerivedTaskState::build(
            &parent,
            &[],
            &[],
            &[sub1_derived, sub2_derived, sub3_derived],
        );

        let progress = derived.subtask_progress.unwrap();
        assert_eq!(progress.total, 3);
        assert_eq!(progress.interrupted, 1);
        assert_eq!(progress.working, 1);
        assert_eq!(progress.blocked, 1);
        assert_eq!(progress.done, 0);
        assert_eq!(progress.failed, 0);
        assert_eq!(progress.has_questions, 0);
        assert_eq!(progress.needs_review, 0);
        assert_eq!(progress.waiting, 0);
    }

    #[test]
    fn test_derived_state_system_active_committing() {
        let mut task = make_task("work");
        task.state = TaskState::committing("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.is_system_active);
        assert!(!derived.is_working);
        assert!(!derived.is_terminal);
    }

    #[test]
    fn test_derived_state_system_active_integrating() {
        let mut task = make_task("work");
        task.state = TaskState::Integrating;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.is_system_active);
        assert!(!derived.is_working);
        assert!(!derived.is_terminal);
    }

    #[test]
    fn test_derived_state_system_active_finishing() {
        let mut task = make_task("work");
        task.state = TaskState::finishing("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.is_system_active);
        assert!(!derived.is_working);
        assert!(!derived.is_terminal);
    }

    #[test]
    fn test_derived_state_not_system_active_for_other_states() {
        let mut task = make_task("work");

        task.state = TaskState::queued("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(!derived.is_system_active);

        task.state = TaskState::agent_working("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(!derived.is_system_active);

        task.state = TaskState::awaiting_approval("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(!derived.is_system_active);

        task.state = TaskState::interrupted("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(!derived.is_system_active);

        task.state = TaskState::awaiting_setup("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(!derived.is_system_active);

        task.state = TaskState::setting_up("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(!derived.is_system_active);
    }

    #[test]
    fn test_derived_state_system_active_terminal_guard() {
        let mut task = make_task("work");
        // In the unified model, a task is either Committing or Failed, not both.
        // This test verifies that a Failed task is not marked as system_active.
        task.state = TaskState::failed("test error");

        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(!derived.is_system_active);
        assert!(derived.is_terminal);
        assert!(derived.is_failed);
    }

    #[test]
    fn test_subtask_progress_system_active() {
        let mut parent = make_task("breakdown");
        parent.state = TaskState::waiting_on_children("work");

        // One system-active subtask (committing)
        let mut sub1 = Task::new("sub-1", "Sub 1", "Desc", "work", "now");
        sub1.state = TaskState::committing("work");
        let sub1_derived = DerivedTaskState::build(&sub1, &[], &[], &[]);

        // One working subtask
        let mut sub2 = Task::new("sub-2", "Sub 2", "Desc", "work", "now");
        sub2.state = TaskState::agent_working("work");
        let sub2_derived = DerivedTaskState::build(&sub2, &[], &[], &[]);

        // One waiting subtask
        let sub3 = Task::new("sub-3", "Sub 3", "Desc", "work", "now");
        let sub3_derived = DerivedTaskState::build(&sub3, &[], &[], &[]);

        let derived = DerivedTaskState::build(
            &parent,
            &[],
            &[],
            &[sub1_derived, sub2_derived, sub3_derived],
        );

        let progress = derived.subtask_progress.unwrap();
        assert_eq!(progress.total, 3);
        assert_eq!(progress.working, 2); // Both system-active and agent-working count as working
        assert_eq!(progress.waiting, 1);
        assert_eq!(progress.done, 0);
        assert_eq!(progress.failed, 0);
    }

    #[test]
    fn test_subtask_progress_failed_system_active() {
        let mut parent = make_task("breakdown");
        parent.state = TaskState::waiting_on_children("work");

        // One failed subtask (in unified model, Failed is a single state)
        let mut sub1 = Task::new("sub-1", "Sub 1", "Desc", "work", "now");
        sub1.state = TaskState::failed("crash during commit");
        let sub1_derived = DerivedTaskState::build(&sub1, &[], &[], &[]);

        // One normal working subtask
        let mut sub2 = Task::new("sub-2", "Sub 2", "Desc", "work", "now");
        sub2.state = TaskState::agent_working("work");
        let sub2_derived = DerivedTaskState::build(&sub2, &[], &[], &[]);

        let derived = DerivedTaskState::build(&parent, &[], &[], &[sub1_derived, sub2_derived]);

        let progress = derived.subtask_progress.unwrap();
        assert_eq!(progress.total, 2);
        assert_eq!(progress.failed, 1); // Failed check comes first
        assert_eq!(progress.working, 1);
        assert_eq!(progress.waiting, 0);
    }

    #[test]
    fn test_phase_icon_committing() {
        let mut task = make_task("work");
        task.state = TaskState::committing("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(derived.phase_icon, Some("committing".to_string()));
    }

    #[test]
    fn test_phase_icon_integrating() {
        let mut task = make_task("work");
        task.state = TaskState::Integrating;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(derived.phase_icon, Some("integrating".to_string()));
    }

    #[test]
    fn test_phase_icon_finishing() {
        let mut task = make_task("work");
        task.state = TaskState::finishing("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(derived.phase_icon, Some("system_busy".to_string()));
    }

    #[test]
    fn test_phase_icon_setting_up() {
        let mut task = make_task("work");
        task.state = TaskState::setting_up("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(derived.phase_icon, Some("setting_up".to_string()));
    }

    #[test]
    fn test_phase_icon_awaiting_setup() {
        let mut task = make_task("work");
        task.state = TaskState::awaiting_setup("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(derived.phase_icon, Some("awaiting_setup".to_string()));
    }

    #[test]
    fn test_phase_icon_idle_waiting() {
        let task = make_task("work");
        // Task is idle with an active status
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(
            derived.phase_icon,
            Some("waiting_for_orchestrator".to_string())
        );
    }

    #[test]
    fn test_phase_icon_waiting_on_children() {
        let mut task = make_task("work");
        task.state = TaskState::waiting_on_children("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        // WaitingOnChildren shows no phase icon
        assert_eq!(derived.phase_icon, None);
    }

    #[test]
    fn test_phase_icon_awaiting_question_answer() {
        let mut task = make_task("work");
        task.state = TaskState::awaiting_question_answer("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        // Human-facing states show no phase icon
        assert_eq!(derived.phase_icon, None);
    }

    #[test]
    fn test_phase_icon_terminal() {
        let mut task = make_task("work");
        task.state = TaskState::failed("err");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        // Terminal tasks don't show phase icons
        assert_eq!(derived.phase_icon, None);
    }

    #[test]
    fn test_phase_icon_agent_working() {
        let mut task = make_task("work");
        task.state = TaskState::agent_working("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(derived.phase_icon, None);
    }

    #[test]
    fn test_phase_icon_awaiting_review() {
        let mut task = make_task("work");
        task.state = TaskState::awaiting_approval("work");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert_eq!(derived.phase_icon, None);
    }

    #[test]
    fn test_is_working_terminal_guard() {
        let mut task = make_task("work");
        // In the unified model, a task is either AgentWorking or Failed, not both.
        // This test verifies that a Failed task is not marked as working.
        task.state = TaskState::failed("err");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(!derived.is_working);
        assert!(derived.is_terminal);
        assert!(derived.is_failed);
    }
}
