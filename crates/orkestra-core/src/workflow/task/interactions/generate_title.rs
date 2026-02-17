//! Generate a task title from its description via AI.

use crate::title::{generate_fallback_title, TitleGenerator};
use crate::workflow::ports::WorkflowStore;

/// Generate a title and save it directly to the store.
///
/// Saves immediately so the UI can display the title before worktree setup finishes.
/// Falls back to a truncated description if AI generation fails.
/// No-op if the task already has a non-empty title.
pub(crate) fn execute(
    store: &dyn WorkflowStore,
    title_gen: &dyn TitleGenerator,
    task_id: &str,
    description: &str,
) {
    let title = match title_gen.generate_title(task_id, description) {
        Ok(title) => title,
        Err(e) => {
            crate::orkestra_debug!(
                "task",
                "WARNING: Title generation failed for {task_id}: {e}"
            );
            generate_fallback_title(description)
        }
    };

    if let Ok(Some(mut task)) = store.get_task(task_id) {
        if task.title.trim().is_empty() {
            task.title = title;
            if let Err(e) = store.save_task(&task) {
                crate::orkestra_debug!("task", "WARNING: Failed to save title for {task_id}: {e}");
            }
        }
    }
}
