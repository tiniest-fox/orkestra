//! Check a task's PR for new feedback and trigger a `PrFeedback` iteration if found.

use std::collections::HashSet;

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{PrCheckData, PrCommentData};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{
    AutoResolveCheckRun, AutoResolveComment, AutoResolveStatus, PrState, ReviewState,
    WorkflowError, WorkflowResult, WorkflowStore,
};
use orkestra_types::domain::ResolvedFeedbackIds;

/// Maximum number of auto-triggered iterations before pausing for human review.
const AUTO_RESOLVE_LIMIT: i32 = 10;

/// Outcome of an auto-resolve poll for a single task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerResult {
    /// No new feedback found — task stays Done.
    NoNewFeedback,
    /// Failed checks exist but CI has not yet fully concluded — waiting for pending runs.
    WaitingForCi,
    /// A `PrFeedback` iteration was created and the task returned to Queued.
    Triggered,
    /// PR is no longer open (closed or merged) — nothing to do.
    PrClosed,
    /// Auto-resolve iteration limit reached — `auto_resolve` disabled.
    LimitReached,
    /// A stale `CHANGES_REQUESTED` review was detected — escalated, `auto_resolve` disabled.
    Escalated,
}

/// New feedback items filtered against already-seen IDs.
struct NewFeedback<'a> {
    checks: Vec<&'a AutoResolveCheckRun>,
    comments: Vec<&'a AutoResolveComment>,
    seen_review_ids: HashSet<i64>,
    stale_changes_requested: bool,
}

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    status: &AutoResolveStatus,
    authenticated_user: &str,
) -> WorkflowResult<TriggerResult> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    // Step 1: PR must still be open
    if status.pr_state != PrState::Open {
        orkestra_debug!(
            "auto_resolve",
            "task {}: PR is not open — skipping",
            task_id
        );
        return Ok(TriggerResult::PrClosed);
    }

    // Step 2: Filter self-comments and compute new unseen feedback
    let external_comments: Vec<_> = status
        .comments
        .iter()
        .filter(|c| c.author != authenticated_user)
        .collect();

    let feedback = compute_new_feedback(status, &external_comments, &task.resolved_feedback_ids);

    // Step 3: Escalate on stale CHANGES_REQUESTED reviews
    if feedback.stale_changes_requested {
        task.auto_resolve = false;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        store.save_task(&task)?;
        orkestra_debug!(
            "auto_resolve",
            "task {}: escalated — stale CHANGES_REQUESTED review, auto_resolve disabled",
            task_id
        );
        return Ok(TriggerResult::Escalated);
    }

    // Step 4: No new feedback
    if feedback.checks.is_empty() && feedback.comments.is_empty() {
        return Ok(TriggerResult::NoNewFeedback);
    }

    // Step 5: Only trigger failed checks when CI is fully concluded
    let effective_checks: Vec<_> = if status.all_checks_concluded {
        feedback.checks
    } else {
        Vec::new()
    };

    if effective_checks.is_empty() && feedback.comments.is_empty() {
        // Failed checks exist but CI hasn't concluded — distinct from "nothing new"
        return Ok(TriggerResult::WaitingForCi);
    }

    // Step 6: Check limit
    if task.auto_resolve_count >= AUTO_RESOLVE_LIMIT {
        task.auto_resolve = false;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        store.save_task(&task)?;
        orkestra_debug!(
            "auto_resolve",
            "task {}: auto_resolve limit reached, auto_resolve disabled",
            task_id
        );
        return Ok(TriggerResult::LimitReached);
    }

    // Step 7: Update resolved IDs and increment count
    for check in &effective_checks {
        task.resolved_feedback_ids.check_run_ids.push(check.id);
    }
    for comment in &feedback.comments {
        task.resolved_feedback_ids.comment_ids.push(comment.id);
    }
    for review in &status.reviews {
        if review.state == ReviewState::ChangesRequested
            && !feedback.seen_review_ids.contains(&review.id)
        {
            task.resolved_feedback_ids.review_ids.push(review.id);
        }
    }
    task.auto_resolve_count += 1;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    // Step 8: Build PrCommentData and PrCheckData
    let pr_comments: Vec<PrCommentData> = feedback
        .comments
        .iter()
        .map(|c| PrCommentData {
            id: Some(c.id),
            author: c.author.clone(),
            body: c.body.clone(),
            path: c.path.clone(),
            line: c.line,
        })
        .collect();

    let pr_checks: Vec<PrCheckData> = effective_checks
        .iter()
        .map(|c| PrCheckData {
            name: c.name.clone(),
            log_excerpt: c.log_excerpt.clone(),
        })
        .collect();

    // Step 9: Save task with updated IDs and count
    store.save_task(&task)?;

    // Step 10: Create PrFeedback iteration and transition task back to Queued
    crate::workflow::human::interactions::address_pr_feedback::execute(
        store,
        workflow,
        iteration_service,
        task_id,
        pr_comments,
        pr_checks,
        None,
    )?;

    orkestra_debug!(
        "auto_resolve",
        "task {}: triggered PrFeedback iteration (count={})",
        task_id,
        task.auto_resolve_count
    );

    Ok(TriggerResult::Triggered)
}

// -- Helpers --

/// Compute which checks, comments, and reviews are new relative to already-seen IDs.
fn compute_new_feedback<'a>(
    status: &'a AutoResolveStatus,
    external_comments: &[&'a AutoResolveComment],
    resolved: &ResolvedFeedbackIds,
) -> NewFeedback<'a> {
    let seen_check_ids: HashSet<i64> = resolved.check_run_ids.iter().copied().collect();
    let seen_comment_ids: HashSet<i64> = resolved.comment_ids.iter().copied().collect();
    let seen_review_ids: HashSet<i64> = resolved.review_ids.iter().copied().collect();

    let checks = status
        .failed_checks
        .iter()
        .filter(|c| !seen_check_ids.contains(&c.id))
        .collect();

    let comments = external_comments
        .iter()
        .copied()
        .filter(|c| !seen_comment_ids.contains(&c.id))
        .collect();

    let stale_changes_requested = status
        .reviews
        .iter()
        .any(|r| r.state == ReviewState::ChangesRequested && seen_review_ids.contains(&r.id));

    NewFeedback {
        checks,
        comments,
        seen_review_ids,
        stale_changes_requested,
    }
}
