//! Process completed agent output. Routes `StageOutput` variants to handlers.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{LogEntry, Task, WorkflowArtifact};
use crate::workflow::execution::StageOutput;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, Resource, ResourceStore, TaskState};
use crate::workflow::stage::interactions as stage;

#[allow(clippy::too_many_lines)]
pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    output: StageOutput,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::AgentWorking { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot process agent output in state {} (expected AgentWorking)",
            task.state
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    let output_type = output.type_label();

    orkestra_debug!(
        "action",
        "process_agent_output {}: type={}, stage={}",
        task_id,
        output_type,
        current_stage
    );

    let now = chrono::Utc::now().to_rfc3339();

    // Capture the active iteration ID before processing output.
    // Used to tag the workflow_artifacts row and ArtifactProduced log entry.
    let iteration_id = store
        .get_active_iteration(task_id, &current_stage)?
        .ok_or_else(|| {
            WorkflowError::InvalidState(format!(
                "no active iteration for task {task_id} in stage {current_stage}"
            ))
        })?
        .id;

    // Persist activity log before processing the output
    if let Some(log) = output.activity_log() {
        iteration_service.set_activity_log(task_id, &current_stage, log)?;
    }

    dispatch_output(
        store,
        workflow,
        iteration_service,
        &mut task,
        output,
        &current_stage,
        &now,
        &iteration_id,
    )?;

    orkestra_debug!(
        "action",
        "process_agent_output {} complete: state={}",
        task_id,
        task.state
    );

    store.save_task(&task)?;
    Ok(task)
}

/// Route a parsed stage output to the appropriate handler.
///
/// Shared between normal agent completion (`process_output::execute`) and
/// chat-mode completion (`try_complete_from_output`). Does NOT load/save
/// the task — callers handle persistence.
///
/// Resources declared in the output are merged into `task.resources` before returning.
/// When an artifact-producing handler returns `Some(artifact_name)`, saves the artifact
/// to `workflow_artifacts` and emits an `ArtifactProduced` log entry.
#[allow(clippy::too_many_arguments)]
pub(crate) fn dispatch_output(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    output: StageOutput,
    current_stage: &str,
    now: &str,
    iteration_id: &str,
) -> WorkflowResult<()> {
    // Extract resources before the match consumes the output.
    let output_resources = output.resources().to_vec();

    let artifact_name: Option<String> = match output {
        StageOutput::Questions { questions, .. } => {
            super::handle_questions::execute(
                workflow,
                iteration_service,
                task,
                &questions,
                current_stage,
                now,
            )?;
            // Emit ArtifactProduced so questions appear at the correct log position.
            Some(stage::finalize_advancement::artifact_name_for_stage(
                workflow,
                &task.flow,
                current_stage,
                "artifact",
            ))
        }
        StageOutput::Artifact { content, .. } => super::handle_artifact::execute(
            workflow,
            iteration_service,
            task,
            &content,
            current_stage,
            now,
        )?,
        StageOutput::Approval {
            decision,
            content,
            route_to,
            ..
        } => super::handle_approval::execute(
            workflow,
            iteration_service,
            task,
            current_stage,
            &decision,
            &content,
            route_to.as_deref(),
            now,
        )?,
        StageOutput::Subtasks {
            content, subtasks, ..
        } => super::handle_subtasks::execute(
            workflow,
            iteration_service,
            task,
            &content,
            &subtasks,
            current_stage,
            now,
        )?,
        StageOutput::Failed { error } => {
            stage::end_iteration::execute(
                iteration_service,
                task,
                Outcome::AgentError {
                    error: error.clone(),
                },
            )?;
            task.state = TaskState::failed_at(current_stage, &error);
            task.updated_at = now.to_string();
            None
        }
        StageOutput::Blocked { reason } => {
            stage::end_iteration::execute(
                iteration_service,
                task,
                Outcome::Blocked {
                    reason: reason.clone(),
                },
            )?;
            task.state = TaskState::blocked_at(current_stage, &reason);
            task.updated_at = now.to_string();
            None
        }
    };

    // Persist artifact to workflow_artifacts table and emit ArtifactProduced log entry.
    if let Some(name) = artifact_name {
        persist_and_emit_artifact(store, task, &name, current_stage, iteration_id)?;
    }

    // Persist any resources the agent declared into the task.
    if !output_resources.is_empty() {
        merge_resources(&mut task.resources, &output_resources, current_stage, now);
    }

    Ok(())
}

/// Save an artifact to `workflow_artifacts` and emit an `ArtifactProduced` log entry.
///
/// The artifact must already be set on `task.artifacts` by the handler. Fails with
/// `InvalidState` if the artifact is missing (indicates a bug in the handler).
fn persist_and_emit_artifact(
    store: &dyn WorkflowStore,
    task: &Task,
    artifact_name: &str,
    current_stage: &str,
    iteration_id: &str,
) -> WorkflowResult<()> {
    let Some(artifact) = task.artifacts.get(artifact_name) else {
        return Err(WorkflowError::InvalidState(format!(
            "artifact '{artifact_name}' not found on task after handler set it"
        )));
    };

    let artifact_id = format!("{iteration_id}-{artifact_name}");

    let workflow_artifact = WorkflowArtifact::new(
        &artifact_id,
        &task.id,
        current_stage,
        artifact_name,
        &artifact.content,
        &artifact.created_at,
    )
    .with_iteration_id(iteration_id);

    store.save_artifact(&workflow_artifact)?;

    // Emit ArtifactProduced log entry to the active stage session.
    let Some(session) = store.get_stage_session(&task.id, current_stage)? else {
        return Ok(());
    };
    store.append_log_entry(
        &session.id,
        &LogEntry::ArtifactProduced {
            name: artifact_name.to_string(),
            artifact_id,
        },
        Some(iteration_id),
    )
}

/// Convert parsed resource output into `Resource` entries and merge into the store.
fn merge_resources(
    store: &mut ResourceStore,
    output_resources: &[orkestra_parser::ResourceOutput],
    stage: &str,
    now: &str,
) {
    for r in output_resources {
        store.set(Resource::new(
            r.name.clone(),
            r.url.clone(),
            r.description.clone(),
            stage,
            now,
        ));
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::testutil::fixtures::{tasks, FIXTURE_TIMESTAMP};
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::WorkflowConfig;
    use crate::workflow::iteration::IterationService;
    use orkestra_parser::types::ResourceOutput;

    fn make_workflow() -> WorkflowConfig {
        crate::testutil::fixtures::test_default_workflow()
    }

    fn make_store_and_service() -> (Arc<InMemoryWorkflowStore>, IterationService) {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = IterationService::new(Arc::clone(&store) as Arc<dyn WorkflowStore>);
        (store, service)
    }

    #[test]
    fn test_dispatch_output_merges_resources_into_task() {
        let (store, iteration_service) = make_store_and_service();
        let workflow = make_workflow();

        let mut task =
            tasks::save_task(store.as_ref(), "task-1", "planning", "Test", "Description").unwrap();
        task.state = TaskState::agent_working("planning");
        iteration_service
            .create_initial_iteration("task-1", "planning")
            .unwrap();
        let iteration_id = store
            .get_active_iteration("task-1", "planning")
            .unwrap()
            .unwrap()
            .id;

        let output = StageOutput::Artifact {
            content: "The plan".into(),
            activity_log: None,
            resources: vec![
                ResourceOutput {
                    name: "design-doc".into(),
                    url: Some("https://docs.example.com".into()),
                    description: Some("Architecture doc".into()),
                },
                ResourceOutput {
                    name: "screenshot".into(),
                    url: Some("/tmp/img.png".into()),
                    description: None,
                },
            ],
        };

        dispatch_output(
            store.as_ref(),
            &workflow,
            &iteration_service,
            &mut task,
            output,
            "planning",
            FIXTURE_TIMESTAMP,
            &iteration_id,
        )
        .unwrap();

        assert_eq!(task.resources.len(), 2);

        let doc = task.resources.get("design-doc").unwrap();
        assert_eq!(doc.url.as_deref(), Some("https://docs.example.com"));
        assert_eq!(doc.description, Some("Architecture doc".into()));
        assert_eq!(doc.stage, "planning");
        assert_eq!(doc.created_at, FIXTURE_TIMESTAMP);

        let shot = task.resources.get("screenshot").unwrap();
        assert_eq!(shot.url.as_deref(), Some("/tmp/img.png"));
        assert!(shot.description.is_none());

        // The artifact should be persisted to workflow_artifacts.
        let stored_artifacts = store.list_artifacts_for_task("task-1").unwrap();
        assert!(
            !stored_artifacts.is_empty(),
            "Artifact output should persist a row to workflow_artifacts"
        );
        assert_eq!(stored_artifacts[0].name, "plan");
    }

    #[test]
    fn test_dispatch_output_without_resources_leaves_task_resources_empty() {
        let (store, iteration_service) = make_store_and_service();
        let workflow = make_workflow();

        let mut task =
            tasks::save_task(store.as_ref(), "task-2", "planning", "Test", "Description").unwrap();
        task.state = TaskState::agent_working("planning");
        iteration_service
            .create_initial_iteration("task-2", "planning")
            .unwrap();
        let iteration_id = store
            .get_active_iteration("task-2", "planning")
            .unwrap()
            .unwrap()
            .id;

        let output = StageOutput::Artifact {
            content: "The plan".into(),
            activity_log: None,
            resources: vec![],
        };

        dispatch_output(
            store.as_ref(),
            &workflow,
            &iteration_service,
            &mut task,
            output,
            "planning",
            FIXTURE_TIMESTAMP,
            &iteration_id,
        )
        .unwrap();

        assert!(task.resources.is_empty());
    }

    #[test]
    fn test_dispatch_output_resources_merge_with_existing() {
        let (store, iteration_service) = make_store_and_service();
        let workflow = make_workflow();

        let mut task =
            tasks::save_task(store.as_ref(), "task-3", "planning", "Test", "Description").unwrap();
        task.state = TaskState::agent_working("planning");
        // Pre-populate a resource from a prior stage
        task.resources.set(Resource::new(
            "existing",
            Some("https://prior.example.com"),
            None::<String>,
            "setup",
            FIXTURE_TIMESTAMP,
        ));
        iteration_service
            .create_initial_iteration("task-3", "planning")
            .unwrap();
        let iteration_id = store
            .get_active_iteration("task-3", "planning")
            .unwrap()
            .unwrap()
            .id;

        let output = StageOutput::Artifact {
            content: "The plan".into(),
            activity_log: None,
            resources: vec![ResourceOutput {
                name: "new-doc".into(),
                url: Some("https://new.example.com".into()),
                description: None,
            }],
        };

        dispatch_output(
            store.as_ref(),
            &workflow,
            &iteration_service,
            &mut task,
            output,
            "planning",
            FIXTURE_TIMESTAMP,
            &iteration_id,
        )
        .unwrap();

        assert_eq!(task.resources.len(), 2);
        assert!(task.resources.get("existing").is_some());
        assert!(task.resources.get("new-doc").is_some());
    }
}
