//! Activity log types for stage execution.

use serde::Serialize;

/// Context for an activity log entry from a prior iteration.
#[derive(Debug, Clone, Serialize)]
pub struct ActivityLogEntry {
    /// Stage that produced this log (e.g., "planning", "work").
    pub stage: String,
    /// Iteration number within the stage.
    pub iteration_number: u32,
    /// The activity log content.
    pub content: String,
    /// RFC3339 timestamp from the iteration's `started_at` field; used for chronological sorting.
    pub timestamp: String,
}

/// A git commit on the task branch.
#[derive(Debug, Clone, Serialize)]
pub struct CommitEntry {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: String,
}

/// A single entry in the activity log timeline.
#[derive(Debug, Clone)]
pub enum ActivityEntry {
    Log(ActivityLogEntry),
    Commit(CommitEntry),
}

impl ActivityEntry {
    /// Sortable timestamp for chronological ordering.
    pub fn sort_key(&self) -> &str {
        match self {
            Self::Log(l) => &l.timestamp,
            Self::Commit(c) => &c.timestamp,
        }
    }
}

/// Consolidate activity logs, collapsing only consecutive same-stage entries.
///
/// Uses "intervening stage prevents deduplication" semantics: consecutive entries from
/// the same stage are collapsed (last wins), but if a different stage appears in between,
/// both entries are preserved.
///
/// **Important**: Callers must provide logs in chronological order (by `started_at`).
///
/// Empty or whitespace-only logs are filtered out.
pub fn deduplicate_activity_logs_by_stage(logs: Vec<ActivityLogEntry>) -> Vec<ActivityLogEntry> {
    let mut result: Vec<ActivityLogEntry> = Vec::new();

    for log in logs {
        // Skip empty/whitespace-only logs
        if log.content.trim().is_empty() {
            continue;
        }

        // Only collapse if the immediately previous entry was from the same stage
        match result.last_mut() {
            Some(prev) if prev.stage == log.stage => *prev = log,
            _ => result.push(log),
        }
    }

    result
}
