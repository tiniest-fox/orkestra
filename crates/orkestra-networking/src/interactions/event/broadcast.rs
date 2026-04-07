//! Converts `OrchestratorEvent` to WebSocket `Event` values for broadcasting.
//!
//! Each orchestrator event maps to one or more client events. `OutputProcessed`
//! may emit a second `review_ready` event when the task needs human action.

use std::sync::{Arc, Mutex};

use orkestra_core::workflow::{OrchestratorEvent, WorkflowApi};

use crate::types::Event;

/// Convert a single `OrchestratorEvent` to zero or more `Event` values.
///
/// The `api` is used to fetch task state for `OutputProcessed` events so we
/// can determine whether to emit a `review_ready` event. The lock is acquired
/// only for that lookup and released immediately.
pub fn execute(event: &OrchestratorEvent, api: &Arc<Mutex<WorkflowApi>>) -> Vec<Event> {
    match event {
        OrchestratorEvent::OutputProcessed {
            task_id,
            stage,
            output_type,
        } => {
            let mut events = vec![Event::task_updated(task_id)];

            // Check if the task now needs human action, and emit review_ready if so.
            if let Ok(api_lock) = api.lock() {
                if let Ok(task) = api_lock.get_task(task_id) {
                    if task.state.needs_human_action() {
                        events.push(Event::review_ready(
                            task_id,
                            task.parent_id.as_deref(),
                            &task.title,
                            stage,
                            output_type,
                        ));
                    }
                }
            }

            events
        }

        OrchestratorEvent::Error { task_id, error } => {
            if let Some(id) = task_id {
                vec![Event::task_updated(id), Event::task_error(id, error)]
            } else {
                vec![]
            }
        }

        OrchestratorEvent::IntegrationFailed {
            task_id,
            error,
            conflict_files,
        } => {
            let mut events = vec![Event::task_updated(task_id)];
            if conflict_files.is_empty() {
                events.push(Event::task_error(task_id, error));
            } else {
                events.push(Event::merge_conflict(task_id, conflict_files.len()));
            }
            events
        }

        OrchestratorEvent::PrCreationFailed { task_id, error } => {
            vec![
                Event::task_updated(task_id),
                Event::task_error(task_id, error),
            ]
        }

        OrchestratorEvent::AgentSpawned { task_id, .. }
        | OrchestratorEvent::IntegrationStarted { task_id, .. }
        | OrchestratorEvent::IntegrationCompleted { task_id }
        | OrchestratorEvent::ParentAdvanced { task_id, .. }
        | OrchestratorEvent::PrCreationStarted { task_id, .. }
        | OrchestratorEvent::PrCreationCompleted { task_id, .. }
        | OrchestratorEvent::GateSpawned { task_id, .. }
        | OrchestratorEvent::GatePassed { task_id, .. }
        | OrchestratorEvent::GateFailed { task_id, .. } => {
            vec![Event::task_updated(task_id)]
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use orkestra_core::adapters::sqlite::DatabaseConnection;
    use orkestra_core::workflow::{
        config::{StageConfig, WorkflowConfig},
        OrchestratorEvent, SqliteWorkflowStore, Task, TaskState, WorkflowApi, WorkflowStore,
    };

    use super::execute;
    use crate::types::Event;

    fn dummy_api() -> Arc<Mutex<WorkflowApi>> {
        let conn = DatabaseConnection::in_memory().expect("in-memory db");
        let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));
        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]);
        Arc::new(Mutex::new(WorkflowApi::new(workflow, store)))
    }

    fn dummy_api_with_store() -> (Arc<Mutex<WorkflowApi>>, Arc<dyn WorkflowStore>) {
        let conn = DatabaseConnection::in_memory().expect("in-memory db");
        let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));
        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]);
        let api = Arc::new(Mutex::new(WorkflowApi::new(workflow, Arc::clone(&store))));
        (api, store)
    }

    fn event_names(events: &[Event]) -> Vec<&str> {
        events.iter().map(|e| e.event.as_str()).collect()
    }

    #[test]
    fn error_with_task_id_emits_task_updated_and_task_error() {
        let api = dummy_api();
        let event = OrchestratorEvent::Error {
            task_id: Some("task-1".into()),
            error: "something went wrong".into(),
        };
        let events = execute(&event, &api);
        assert_eq!(event_names(&events), vec!["task_updated", "task_error"]);
    }

    #[test]
    fn error_without_task_id_emits_nothing() {
        let api = dummy_api();
        let event = OrchestratorEvent::Error {
            task_id: None,
            error: "global error".into(),
        };
        let events = execute(&event, &api);
        assert!(events.is_empty());
    }

    #[test]
    fn integration_failed_with_conflicts_emits_merge_conflict() {
        let api = dummy_api();
        let event = OrchestratorEvent::IntegrationFailed {
            task_id: "task-2".into(),
            error: "merge failed".into(),
            conflict_files: vec!["src/foo.rs".into(), "src/bar.rs".into()],
        };
        let events = execute(&event, &api);
        assert_eq!(event_names(&events), vec!["task_updated", "merge_conflict"]);
        // Verify conflict_count in payload
        assert_eq!(events[1].payload["conflict_count"], 2);
    }

    #[test]
    fn integration_failed_without_conflicts_emits_task_error() {
        let api = dummy_api();
        let event = OrchestratorEvent::IntegrationFailed {
            task_id: "task-3".into(),
            error: "rebase failed".into(),
            conflict_files: vec![],
        };
        let events = execute(&event, &api);
        assert_eq!(event_names(&events), vec!["task_updated", "task_error"]);
        assert_eq!(events[1].payload["error"], "rebase failed");
    }

    #[test]
    fn pr_creation_failed_emits_task_error() {
        let api = dummy_api();
        let event = OrchestratorEvent::PrCreationFailed {
            task_id: "task-4".into(),
            error: "pr failed".into(),
        };
        let events = execute(&event, &api);
        assert_eq!(event_names(&events), vec!["task_updated", "task_error"]);
        assert_eq!(events[1].payload["error"], "pr failed");
    }

    #[test]
    fn output_processed_emits_review_ready_when_needs_human_action() {
        let (api, store) = dummy_api_with_store();

        // Create a task and set it to awaiting_approval (needs_human_action = true)
        let mut task: Task = {
            let api_lock = api.lock().unwrap();
            api_lock
                .create_task("Fix bug", "Fix the login bug", None)
                .unwrap()
        };
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let event = OrchestratorEvent::OutputProcessed {
            task_id: task.id.clone(),
            stage: "work".into(),
            output_type: "default".into(),
        };
        let events = execute(&event, &api);

        assert_eq!(event_names(&events), vec!["task_updated", "review_ready"]);
        assert_eq!(events[1].payload["task_title"], "Fix bug");
        assert_eq!(events[1].payload["stage"], "work");
        assert_eq!(events[1].payload["output_type"], "default");
        assert_eq!(events[1].payload["notification_title"], "Ready for review");
        assert_eq!(
            events[1].payload["notification_body"],
            "Fix bug — work stage output ready"
        );
    }

    #[test]
    fn output_processed_emits_only_task_updated_when_no_human_action() {
        let (api, store) = dummy_api_with_store();

        // Create a task in queued state (needs_human_action = false)
        let task: Task = {
            let api_lock = api.lock().unwrap();
            api_lock
                .create_task("Fix bug", "Fix the login bug", None)
                .unwrap()
        };
        // Task starts in queued state — does not need human action
        // Save so get_task() succeeds in execute()
        store.save_task(&task).unwrap();

        let event = OrchestratorEvent::OutputProcessed {
            task_id: task.id.clone(),
            stage: "work".into(),
            output_type: "default".into(),
        };
        let events = execute(&event, &api);

        assert_eq!(event_names(&events), vec!["task_updated"]);
    }
}
