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
        OrchestratorEvent::AgentSpawned { task_id, .. } => {
            vec![Event::task_updated(task_id)]
        }

        OrchestratorEvent::OutputProcessed { task_id, .. } => {
            let mut events = vec![Event::task_updated(task_id)];

            // Check if the task now needs human action, and emit review_ready if so.
            if let Ok(api_lock) = api.lock() {
                if let Ok(task) = api_lock.get_task(task_id) {
                    if task.state.needs_human_action() {
                        events.push(Event::review_ready(task_id, task.parent_id.as_deref()));
                    }
                }
            }

            events
        }

        OrchestratorEvent::Error { task_id, .. } => {
            if let Some(id) = task_id {
                vec![Event::task_updated(id)]
            } else {
                vec![]
            }
        }

        OrchestratorEvent::IntegrationStarted { task_id, .. }
        | OrchestratorEvent::IntegrationCompleted { task_id }
        | OrchestratorEvent::IntegrationFailed { task_id, .. }
        | OrchestratorEvent::ParentAdvanced { task_id, .. }
        | OrchestratorEvent::PrCreationStarted { task_id, .. }
        | OrchestratorEvent::PrCreationCompleted { task_id, .. }
        | OrchestratorEvent::PrCreationFailed { task_id, .. }
        | OrchestratorEvent::GateSpawned { task_id, .. }
        | OrchestratorEvent::GatePassed { task_id, .. }
        | OrchestratorEvent::GateFailed { task_id, .. } => {
            vec![Event::task_updated(task_id)]
        }
    }
}
