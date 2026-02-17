//! Create subtask records from an approved breakdown.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{extract_short_id, Task};
use crate::workflow::execution::SubtaskOutput;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Artifact, TaskState};

pub fn execute(
    parent: &Task,
    workflow: &WorkflowConfig,
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    breakdown_artifact_name: &str,
) -> WorkflowResult<Vec<Task>> {
    let structured_key = format!("{breakdown_artifact_name}_structured");
    let json = parent.artifacts.content(&structured_key).ok_or_else(|| {
        WorkflowError::InvalidTransition("No structured subtask data found on task".to_string())
    })?;

    let subtask_outputs: Vec<SubtaskOutput> = serde_json::from_str(json).map_err(|e| {
        WorkflowError::InvalidTransition(format!("Failed to parse structured subtask data: {e}"))
    })?;

    if subtask_outputs.is_empty() {
        return Ok(Vec::new());
    }

    let subtask_flow = find_subtask_flow(parent, workflow);

    let first_stage = workflow
        .first_stage_in_flow(subtask_flow.as_deref())
        .ok_or_else(|| WorkflowError::InvalidTransition("No stages in subtask flow".to_string()))?;

    let now = chrono::Utc::now().to_rfc3339();

    // First pass: create all tasks and save immediately so next_subtask_id
    // can see already-created siblings when checking last-word uniqueness.
    let mut created_tasks: Vec<Task> = Vec::with_capacity(subtask_outputs.len());
    let mut index_to_id: Vec<String> = Vec::with_capacity(subtask_outputs.len());

    for output in &subtask_outputs {
        let id = store.next_subtask_id(&parent.id)?;
        let short_id = extract_short_id(&id);

        let mut task = Task::new(
            &id,
            &output.title,
            &output.description,
            &first_stage.name,
            &now,
        );
        task.parent_id = Some(parent.id.clone());
        task.short_id = Some(short_id);
        task.flow.clone_from(&subtask_flow);
        task.auto_mode = parent.auto_mode;

        // Subtasks branch from parent's branch (worktree created during setup)
        task.base_branch = parent
            .branch_name
            .clone()
            .unwrap_or_else(|| parent.base_branch.clone());

        // Create per-subtask breakdown artifact from detailed_instructions
        task.artifacts.set(Artifact::new(
            breakdown_artifact_name,
            &output.detailed_instructions,
            breakdown_artifact_name,
            &now,
        ));

        // Start in AwaitingSetup - orchestrator will pick this up when deps are satisfied
        task.state = TaskState::awaiting_setup(&first_stage.name);

        // Save immediately so subsequent next_subtask_id calls see this sibling
        store.save_task(&task)?;

        index_to_id.push(id);
        created_tasks.push(task);
    }

    // Second pass: set dependencies using the index→ID mapping, then finalize
    for (i, output) in subtask_outputs.iter().enumerate() {
        let deps: Vec<String> = output
            .depends_on
            .iter()
            .filter_map(|&idx| index_to_id.get(idx).cloned())
            .collect();
        created_tasks[i].depends_on = deps;

        // Re-save with dependencies set
        store.save_task(&created_tasks[i])?;
        iteration_service.create_initial_iteration(&created_tasks[i].id, &first_stage.name)?;
    }

    Ok(created_tasks)
}

// -- Helpers --

/// Find the subtask flow for a parent task based on its current stage's capabilities.
fn find_subtask_flow(parent: &Task, workflow: &WorkflowConfig) -> Option<String> {
    for stage in &workflow.stages {
        let effective_caps = workflow
            .effective_capabilities(&stage.name, parent.flow.as_deref())
            .unwrap_or_default();
        if effective_caps.produces_subtasks() {
            return effective_caps.subtask_flow().map(String::from);
        }
    }
    None
}
