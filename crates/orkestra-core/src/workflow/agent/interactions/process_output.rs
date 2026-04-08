//! Process completed agent output. Routes `StageOutput` variants to handlers.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{LogEntry, Task};
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

    // Persist activity log before processing the output
    if let Some(log) = output.activity_log() {
        iteration_service.set_activity_log(task_id, &current_stage, log)?;
    }

    // Capture active iteration ID before dispatch (handlers may end the iteration).
    let iteration_id = store
        .get_active_iteration(task_id, &current_stage)?
        .map(|it| it.id);

    dispatch_output(
        store,
        workflow,
        iteration_service,
        &mut task,
        output,
        &current_stage,
        &now,
        iteration_id.as_deref(),
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
/// After artifact-producing handlers, writes the artifact to the `workflow_artifacts`
/// table and emits an `ArtifactProduced` log entry to the stage session.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_lines)]
pub(crate) fn dispatch_output(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    output: StageOutput,
    current_stage: &str,
    now: &str,
    iteration_id: Option<&str>,
) -> WorkflowResult<()> {
    // Extract resources before the match consumes the output.
    let output_resources = output.resources().to_vec();

    match output {
        StageOutput::Questions { questions, .. } => {
            super::handle_questions::execute(
                workflow,
                iteration_service,
                task,
                &questions,
                current_stage,
                now,
            )?;
        }
        StageOutput::Artifact { content, .. } => {
            super::handle_artifact::execute(
                workflow,
                iteration_service,
                task,
                &content,
                current_stage,
                now,
            )?;
            let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
                workflow,
                &task.flow,
                current_stage,
                "artifact",
            );
            persist_and_emit_artifact(store, task, &artifact_name, current_stage, iteration_id)?;
        }
        StageOutput::Approval {
            decision, content, ..
        } => {
            super::handle_approval::execute(
                workflow,
                iteration_service,
                task,
                current_stage,
                &decision,
                &content,
                now,
            )?;
            // Only emit for approve path — reject artifacts are confusing in log view.
            if decision == "approve" {
                let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
                    workflow,
                    &task.flow,
                    current_stage,
                    "artifact",
                );
                persist_and_emit_artifact(
                    store,
                    task,
                    &artifact_name,
                    current_stage,
                    iteration_id,
                )?;
            }
        }
        StageOutput::Subtasks {
            content, subtasks, ..
        } => {
            super::handle_subtasks::execute(
                workflow,
                iteration_service,
                task,
                &content,
                &subtasks,
                current_stage,
                now,
            )?;
            // Emit for the primary human-readable artifact, NOT the _structured JSON.
            let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
                workflow,
                &task.flow,
                current_stage,
                "breakdown",
            );
            persist_and_emit_artifact(store, task, &artifact_name, current_stage, iteration_id)?;
        }
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
        }
    }

    // Persist any resources the agent declared into the task.
    if !output_resources.is_empty() {
        merge_resources(&mut task.resources, &output_resources, current_stage, now);
    }

    Ok(())
}

/// Write artifact to the `workflow_artifacts` table and emit an `ArtifactProduced` log entry.
///
/// Silently succeeds if the stage session is missing; fails fast if the artifact is missing.
fn persist_and_emit_artifact(
    store: &dyn WorkflowStore,
    task: &Task,
    artifact_name: &str,
    current_stage: &str,
    iteration_id: Option<&str>,
) -> WorkflowResult<()> {
    let Some(artifact) = task.artifacts.get(artifact_name) else {
        return Err(WorkflowError::InvalidState(format!(
            "artifact '{artifact_name}' not found on task after handler set it"
        )));
    };

    store.save_artifact(&task.id, artifact)?;

    let Some(session) = store.get_stage_session(&task.id, current_stage)? else {
        return Ok(());
    };
    store.append_log_entry(
        &session.id,
        &LogEntry::ArtifactProduced {
            artifact: artifact.clone(),
        },
        iteration_id,
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

        let output = StageOutput::Artifact {
            content: "The plan".into(),
            activity_log: None,
            resources: vec![
                ResourceOutput {
                    name: "design-doc".into(),
                    url: "https://docs.example.com".into(),
                    description: Some("Architecture doc".into()),
                },
                ResourceOutput {
                    name: "screenshot".into(),
                    url: "/tmp/img.png".into(),
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
            None,
        )
        .unwrap();

        assert_eq!(task.resources.len(), 2);

        let doc = task.resources.get("design-doc").unwrap();
        assert_eq!(doc.url, "https://docs.example.com");
        assert_eq!(doc.description, Some("Architecture doc".into()));
        assert_eq!(doc.stage, "planning");
        assert_eq!(doc.created_at, FIXTURE_TIMESTAMP);

        let shot = task.resources.get("screenshot").unwrap();
        assert_eq!(shot.url, "/tmp/img.png");
        assert!(shot.description.is_none());
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
            None,
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
            "https://prior.example.com",
            None::<String>,
            "setup",
            FIXTURE_TIMESTAMP,
        ));
        iteration_service
            .create_initial_iteration("task-3", "planning")
            .unwrap();

        let output = StageOutput::Artifact {
            content: "The plan".into(),
            activity_log: None,
            resources: vec![ResourceOutput {
                name: "new-doc".into(),
                url: "https://new.example.com".into(),
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
            None,
        )
        .unwrap();

        assert_eq!(task.resources.len(), 2);
        assert!(task.resources.get("existing").is_some());
        assert!(task.resources.get("new-doc").is_some());
    }
}
