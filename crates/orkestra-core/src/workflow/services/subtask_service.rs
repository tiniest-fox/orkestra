//! Subtask service - organizational home for subtask-related operations.
//!
//! This service centralizes subtask operations: converting breakdown output
//! to markdown artifacts, and creating Task records from approved breakdowns.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::task::generate_short_id;
use crate::workflow::domain::Task;
use crate::workflow::execution::SubtaskOutput;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;
use std::sync::Arc;

use super::task_setup::TaskSetupService;
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
        setup_service: &Arc<TaskSetupService>,
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

        // First pass: create all tasks and collect ID mapping (index → task_id)
        let mut created_tasks: Vec<Task> = Vec::with_capacity(subtask_outputs.len());
        let mut index_to_id: Vec<String> = Vec::with_capacity(subtask_outputs.len());
        let mut short_ids: Vec<Option<String>> = Vec::new();

        for output in &subtask_outputs {
            let id = store.next_task_id()?;
            let short_id = generate_short_id(&id, &short_ids);

            let mut task = Task::new(
                &id,
                &output.title,
                &output.description,
                &first_stage.name,
                &now,
            );
            task.parent_id = Some(parent.id.clone());
            task.short_id = Some(short_id.clone());
            task.flow.clone_from(&subtask_flow);
            task.auto_mode = parent.auto_mode;

            // Subtasks inherit parent's worktree
            task.worktree_path.clone_from(&parent.worktree_path);
            task.branch_name.clone_from(&parent.branch_name);

            // Copy parent's plan artifact to subtask (if it exists)
            if let Some(plan) = parent.artifacts.get("plan") {
                task.artifacts.set(plan.clone());
            }

            // Start in SettingUp for consistency
            task.phase = Phase::SettingUp;

            short_ids.push(Some(short_id));
            index_to_id.push(id);
            created_tasks.push(task);
        }

        // Second pass: set dependencies using the index→ID mapping
        for (i, output) in subtask_outputs.iter().enumerate() {
            let deps: Vec<String> = output
                .depends_on
                .iter()
                .filter_map(|&idx| index_to_id.get(idx).cloned())
                .collect();
            created_tasks[i].depends_on = deps;
        }

        // Save all tasks, create iterations, and spawn setup
        for task in &created_tasks {
            store.save_task(task)?;
            iteration_service.create_initial_iteration(&task.id, &first_stage.name)?;
            setup_service.spawn_subtask_setup(task.id.clone());
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

