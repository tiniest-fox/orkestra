//! Set up tasks in `AwaitingSetup` phase whose dependencies are satisfied.

use std::collections::HashSet;

use crate::orkestra_debug;
use crate::workflow::domain::TickSnapshot;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use crate::workflow::task::setup::TaskSetupService;

/// Set up tasks whose dependencies are satisfied.
///
/// Handles both parent tasks and subtasks. For subtasks, setup is deferred
/// from creation time to allow dependent subtasks to branch from the parent
/// after predecessors' changes have been merged back.
///
/// Returns the set of task IDs that were set up during this call.
/// Used by `tick()` to prevent `start_new_executions` from immediately
/// spawning agents for tasks that just completed synchronous setup.
pub fn execute(
    store: &dyn WorkflowStore,
    setup_service: &TaskSetupService,
    snapshot: &TickSnapshot,
) -> WorkflowResult<HashSet<String>> {
    if snapshot.awaiting_setup.is_empty() {
        return Ok(HashSet::new());
    }

    let mut just_set_up = HashSet::new();

    for header in &snapshot.awaiting_setup {
        // For subtasks: check all dependencies are satisfied (fully integrated)
        if header.parent_id.is_some()
            && !header
                .depends_on
                .iter()
                .all(|dep| snapshot.integrated_ids.contains(dep))
        {
            continue;
        }

        orkestra_debug!(
            "orchestrator",
            "Setting up task {} (deps satisfied)",
            header.id
        );

        // Load full task to save (save_task needs Task, not TaskHeader)
        let Some(mut task) = store.get_task(&header.id)? else {
            continue;
        };

        // Transition to SettingUp BEFORE spawning (prevents double-spawn)
        let stage = task.current_stage().unwrap_or("unknown").to_string();
        task.state = TaskState::setting_up(stage);
        store.save_task(&task)?;

        just_set_up.insert(task.id.clone());

        // Spawn setup (handles worktree creation and title generation)
        let needs_title = task.title.trim().is_empty() && !task.description.trim().is_empty();
        setup_service.spawn_setup(
            task.id.clone(),
            task.base_branch.clone(),
            if needs_title {
                Some(task.description.clone())
            } else {
                None
            },
        );
    }

    Ok(just_set_up)
}
