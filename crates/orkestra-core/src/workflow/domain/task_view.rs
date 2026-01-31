//! Rich task view for API responses.
//!
//! `TaskView` combines a task with pre-joined data (iterations, stage sessions)
//! and a `DerivedTaskState` computed from domain predicates. This lets the frontend
//! be a thin render layer — all business logic lives in the Rust domain model.

use serde::{Deserialize, Serialize};

use super::question::Question;
use super::stage_session::StageSession;
use super::task::Task;
use crate::workflow::domain::Iteration;
use crate::workflow::runtime::Outcome;

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
/// predicates on Task/Status/Phase — no duplicated logic.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerivedTaskState {
    pub current_stage: Option<String>,
    pub is_working: bool,
    pub is_failed: bool,
    pub is_blocked: bool,
    pub is_done: bool,
    pub is_terminal: bool,
    pub is_waiting_on_children: bool,
    pub needs_review: bool,
    pub has_questions: bool,
    pub pending_questions: Vec<Question>,
    pub rejection_feedback: Option<String>,
    pub stages_with_logs: Vec<String>,
    pub subtask_progress: Option<SubtaskProgress>,
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
    pub has_questions: usize,
    pub needs_review: usize,
    pub working: usize,
    /// Idle/waiting — not in any of the above states.
    pub waiting: usize,
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
        let stages_with_logs = sessions.iter().map(|s| s.stage.clone()).collect();
        let subtask_progress = compute_subtask_progress(subtask_states);

        Self {
            current_stage: task.current_stage().map(str::to_string),
            is_working: task.phase.has_active_agent(),
            is_failed: task.is_failed(),
            is_blocked: task.is_blocked(),
            is_done: task.is_done(),
            is_terminal: task.is_terminal(),
            is_waiting_on_children: task.status.is_waiting_on_children(),
            needs_review: task.needs_review(),
            has_questions: !pending_questions.is_empty(),
            pending_questions,
            rejection_feedback,
            stages_with_logs,
            subtask_progress,
        }
    }
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
        has_questions: 0,
        needs_review: 0,
        working: 0,
        waiting: 0,
    };

    for s in subtask_states {
        if s.is_done || (s.is_terminal && !s.is_failed && !s.is_blocked) {
            progress.done += 1;
        } else if s.is_failed {
            progress.failed += 1;
        } else if s.is_blocked {
            progress.blocked += 1;
        } else if s.has_questions {
            progress.has_questions += 1;
        } else if s.needs_review {
            progress.needs_review += 1;
        } else if s.is_working {
            progress.working += 1;
        } else {
            progress.waiting += 1;
        }
    }

    Some(progress)
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

    // Find the most recent rejection or restage outcome for this stage
    let mut stage_iterations: Vec<_> = iterations.iter().filter(|i| i.stage == stage).collect();
    stage_iterations.sort_by_key(|i| i.iteration_number);

    for iteration in stage_iterations.into_iter().rev() {
        if let Some(Outcome::Rejected { feedback, .. } | Outcome::Restage { feedback, .. }) =
            &iteration.outcome
        {
            return Some(feedback.clone());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::stage_session::SessionState;
    use crate::workflow::domain::Question;
    use crate::workflow::runtime::{Phase, Status};

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
        task.phase = Phase::AgentWorking;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.is_working);
        assert!(!derived.needs_review);
    }

    #[test]
    fn test_derived_state_needs_review() {
        let mut task = make_task("planning");
        task.phase = Phase::AwaitingReview;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        assert!(derived.needs_review);
        assert!(!derived.is_working);
    }

    #[test]
    fn test_derived_state_review_requires_active_status() {
        let mut task = make_task("planning");
        task.phase = Phase::AwaitingReview;
        task.status = Status::Done;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);

        // Done + AwaitingReview should not count as needs_review
        assert!(!derived.needs_review);
    }

    #[test]
    fn test_derived_state_terminal_states() {
        let mut task = make_task("planning");

        task.status = Status::Done;
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(derived.is_done);
        assert!(derived.is_terminal);
        assert!(derived.current_stage.is_none());

        task.status = Status::failed("error");
        let derived = DerivedTaskState::build(&task, &[], &[], &[]);
        assert!(derived.is_failed);
        assert!(derived.is_terminal);

        task.status = Status::blocked("reason");
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

        let mut session1 = StageSession::new("ss-1", "task-1", "planning", "now");
        session1.session_state = SessionState::Active;

        let mut session2 = StageSession::new("ss-2", "task-1", "work", "now");
        session2.session_state = SessionState::Spawning;

        let derived = DerivedTaskState::build(&task, &[], &[session1, session2], &[]);

        // All sessions produce tabs, including Spawning
        assert_eq!(derived.stages_with_logs, vec!["planning", "work"]);
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
        parent.status = Status::waiting_on_children("work");

        // Build derived states for subtasks
        let mut sub1 = Task::new("sub-1", "Sub 1", "Desc", "work", "now");
        sub1.status = Status::Done;
        let sub1_derived = DerivedTaskState::build(&sub1, &[], &[], &[]);

        let sub2 = Task::new("sub-2", "Sub 2", "Desc", "work", "now");
        let sub2_derived = DerivedTaskState::build(&sub2, &[], &[], &[]);

        let mut sub3 = Task::new("sub-3", "Sub 3", "Desc", "work", "now");
        sub3.status = Status::failed("error");
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
        parent.status = Status::waiting_on_children("work");

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
        sub_r.phase = Phase::AwaitingReview;
        let derived_review = DerivedTaskState::build(&sub_r, &[], &[], &[]);

        // Subtask working
        let mut sub_w = Task::new("sub-w", "W", "Desc", "work", "now");
        sub_w.phase = Phase::AgentWorking;
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
}
