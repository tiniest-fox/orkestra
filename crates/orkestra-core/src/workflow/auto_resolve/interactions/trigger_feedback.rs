//! Check a task's PR for new feedback and trigger a `PrFeedback` iteration if found.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{PrCheckData, PrCommentData};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{AutoResolveStatus, WorkflowError, WorkflowResult, WorkflowStore};

/// Outcome of an auto-resolve poll for a single task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerResult {
    /// No new feedback found — task stays Done.
    NoNewFeedback,
    /// A `PrFeedback` iteration was created and the task returned to Queued.
    Triggered,
    /// PR is no longer open (closed or merged) — nothing to do.
    PrClosed,
    /// Auto-resolve iteration limit (10) reached — `auto_resolve` disabled.
    LimitReached,
    /// A stale `CHANGES_REQUESTED` review was detected — escalated, `auto_resolve` disabled.
    Escalated,
}

#[allow(clippy::too_many_lines)]
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
    if status.pr_state != "OPEN" {
        orkestra_debug!(
            "auto_resolve",
            "task {}: PR is {} — skipping",
            task_id,
            status.pr_state
        );
        return Ok(TriggerResult::PrClosed);
    }

    // Step 2: Filter self-comments
    let external_comments: Vec<_> = status
        .comments
        .iter()
        .filter(|c| c.author != authenticated_user)
        .collect();

    // Step 3: Compute new (unseen) IDs
    let seen_check_ids: std::collections::HashSet<i64> = task
        .resolved_feedback_ids
        .check_run_ids
        .iter()
        .copied()
        .collect();
    let seen_comment_ids: std::collections::HashSet<i64> = task
        .resolved_feedback_ids
        .comment_ids
        .iter()
        .copied()
        .collect();

    let new_checks: Vec<_> = status
        .failed_checks
        .iter()
        .filter(|c| !seen_check_ids.contains(&c.id))
        .collect();
    let new_comments: Vec<_> = external_comments
        .iter()
        .filter(|c| !seen_comment_ids.contains(&c.id))
        .collect();

    // Step 4: Escalate on stale CHANGES_REQUESTED reviews we've already processed
    let seen_review_ids: std::collections::HashSet<i64> = task
        .resolved_feedback_ids
        .review_ids
        .iter()
        .copied()
        .collect();
    let stale_changes_requested = status
        .reviews
        .iter()
        .any(|r| r.state == "CHANGES_REQUESTED" && seen_review_ids.contains(&r.id));

    if stale_changes_requested {
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

    // Step 5: No new feedback
    if new_checks.is_empty() && new_comments.is_empty() {
        return Ok(TriggerResult::NoNewFeedback);
    }

    // Step 6: Only trigger failed checks when CI is fully concluded
    let effective_new_checks: Vec<_> = if status.all_checks_concluded {
        new_checks
    } else {
        Vec::new()
    };

    if effective_new_checks.is_empty() && new_comments.is_empty() {
        return Ok(TriggerResult::NoNewFeedback);
    }

    // Step 7: Check limit
    if task.auto_resolve_count >= 10 {
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

    // Step 8: Update resolved IDs and increment count
    for check in &effective_new_checks {
        task.resolved_feedback_ids.check_run_ids.push(check.id);
    }
    for comment in &new_comments {
        task.resolved_feedback_ids.comment_ids.push(comment.id);
    }
    // Track new review IDs from reviews in CHANGES_REQUESTED state so we can
    // detect stale reviews on subsequent polls
    for review in &status.reviews {
        if review.state == "CHANGES_REQUESTED" && !seen_review_ids.contains(&review.id) {
            task.resolved_feedback_ids.review_ids.push(review.id);
        }
    }
    task.auto_resolve_count += 1;
    if task.auto_resolve_count >= 10 {
        task.auto_resolve = false;
    }
    let now = chrono::Utc::now().to_rfc3339();
    task.updated_at = now;

    // Step 9: Build PrCommentData and PrCheckData
    let pr_comments: Vec<PrCommentData> = new_comments
        .iter()
        .map(|c| PrCommentData {
            id: Some(c.id),
            author: c.author.clone(),
            body: c.body.clone(),
            path: c.path.clone(),
            line: c.line,
        })
        .collect();

    let pr_checks: Vec<PrCheckData> = effective_new_checks
        .iter()
        .map(|c| PrCheckData {
            name: c.name.clone(),
            log_excerpt: c.log_excerpt.clone(),
        })
        .collect();

    // Step 10: Save task with updated IDs and count
    store.save_task(&task)?;

    // Step 11: Create PrFeedback iteration and transition task back to Queued
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
