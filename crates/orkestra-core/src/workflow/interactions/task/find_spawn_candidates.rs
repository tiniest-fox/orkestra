//! Filter tasks that are ready for agent/script execution.

use std::collections::HashSet;

use crate::workflow::domain::{TaskHeader, TickSnapshot};

/// Find tasks that are ready to have agents or scripts spawned.
///
/// Filters `snapshot.idle_active` by: dependencies satisfied, not deferred,
/// no active execution already running.
///
/// Pure filtering — no state changes, no I/O.
pub fn execute<'a, S: ::std::hash::BuildHasher, S2: ::std::hash::BuildHasher>(
    snapshot: &'a TickSnapshot,
    defer_spawn_ids: &HashSet<String, S>,
    active_task_ids: &HashSet<String, S2>,
) -> Vec<&'a TaskHeader> {
    snapshot
        .idle_active
        .iter()
        .filter(|h| {
            h.depends_on
                .iter()
                .all(|dep| snapshot.done_ids.contains(dep))
        })
        .filter(|h| !defer_spawn_ids.contains(&h.id))
        .filter(|h| !active_task_ids.contains(&h.id))
        .collect()
}
