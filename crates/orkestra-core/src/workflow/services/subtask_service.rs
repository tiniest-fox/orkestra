//! Subtask service - organizational home for subtask-related operations.
//!
//! This service centralizes subtask operations: converting breakdown output
//! to markdown artifacts, and creating Task records from approved breakdowns.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::task::extract_short_id;
use crate::workflow::domain::Task;
use crate::workflow::execution::SubtaskOutput;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;
use std::sync::Arc;

use super::IterationService;

/// Service for subtask-related operations.
///
/// Creates Task records from approved breakdowns with proper
/// dependencies, flow assignment, and artifact inheritance.
pub struct SubtaskService;

impl SubtaskService {
    /// Create Task records from an approved breakdown.
    ///
    /// Reads the structured subtask data from the `{artifact_name}_structured` artifact,
    /// creates a Task for each subtask with proper dependencies and flow assignment,
    /// and copies the parent's plan artifact to each subtask.
    ///
    /// Returns the list of created subtask Tasks.
    pub fn create_subtasks_from_breakdown(
        parent: &Task,
        workflow: &WorkflowConfig,
        store: &Arc<dyn WorkflowStore>,
        iteration_service: &Arc<IterationService>,
        breakdown_artifact_name: &str,
    ) -> WorkflowResult<Vec<Task>> {
        let structured_key = format!("{breakdown_artifact_name}_structured");
        let json = parent.artifacts.content(&structured_key).ok_or_else(|| {
            WorkflowError::InvalidTransition("No structured subtask data found on task".to_string())
        })?;

        let subtask_outputs: Vec<SubtaskOutput> = serde_json::from_str(json).map_err(|e| {
            WorkflowError::InvalidTransition(format!(
                "Failed to parse structured subtask data: {e}"
            ))
        })?;

        if subtask_outputs.is_empty() {
            return Ok(Vec::new());
        }

        // Determine which flow subtasks should use
        let subtask_flow = find_subtask_flow(parent, workflow);

        // Determine first stage for subtasks (using their flow)
        let first_stage = workflow
            .first_stage_in_flow(subtask_flow.as_deref())
            .ok_or_else(|| {
                WorkflowError::InvalidTransition("No stages in subtask flow".to_string())
            })?;

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

            // Copy parent's plan artifact to subtask (if it exists)
            if let Some(plan) = parent.artifacts.get("plan") {
                task.artifacts.set(plan.clone());
            }

            // Start in SettingUp for consistency
            task.phase = Phase::SettingUp;

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
            // Setup is deferred to the orchestrator tick loop (setup_ready_subtasks),
            // which triggers spawn_setup() only after dependencies are satisfied.
            // This ensures dependent subtasks branch from the parent after
            // predecessors' changes have been merged back.
        }

        Ok(created_tasks)
    }
}

/// Find the subtask flow for a parent task based on its current stage's capabilities.
///
/// Looks at the stage that produced the breakdown (the stage the parent is in or
/// just approved from) and returns the subtask flow from its effective capabilities.
fn find_subtask_flow(parent: &Task, workflow: &WorkflowConfig) -> Option<String> {
    // The breakdown stage is typically the stage that was just approved.
    // We look through all stages for one with subtask capabilities.
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
