//! Transform sibling tasks into template context for agent prompts.

use crate::workflow::domain::Task;
use crate::workflow::execution::{sibling_status_display, SiblingTaskContext};

/// Filter and transform sibling tasks into prompt context.
///
/// Excludes the current task and archived siblings. Computes dependency
/// relationships relative to the current task.
pub fn execute(current_task: &Task, all_siblings: Vec<Task>) -> Vec<SiblingTaskContext> {
    all_siblings
        .into_iter()
        .filter(|s| s.id != current_task.id) // Exclude self
        .filter(|s| !s.is_archived()) // Exclude archived
        .map(|sibling| {
            let dependency_relationship = if sibling.depends_on.contains(&current_task.id) {
                Some("depends on this task".to_string())
            } else if current_task.depends_on.contains(&sibling.id) {
                Some("this task depends on".to_string())
            } else {
                None
            };

            SiblingTaskContext {
                short_id: sibling
                    .short_id
                    .clone()
                    .unwrap_or_else(|| sibling.id.clone()),
                title: sibling.title.clone(),
                description: sibling.description.clone(),
                dependency_relationship,
                status_display: sibling_status_display(&sibling.state).to_string(),
            }
        })
        .collect()
}
