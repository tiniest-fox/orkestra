//! Iteration service - single source of truth for iteration management.
//!
//! This service centralizes all iteration creation and lifecycle operations,
//! ensuring consistent ID formats, numbering schemes, and state transitions.

use crate::workflow::domain::{ArtifactSnapshot, Iteration, IterationTrigger};
use crate::workflow::ports::WorkflowStore;
use crate::workflow::runtime::Outcome;
use crate::workflow::WorkflowResult;
use chrono::Utc;
use std::sync::Arc;

/// Service for managing iteration lifecycle.
///
/// All iteration creation MUST go through this service to ensure:
/// - Consistent ID format: `{task_id}-{stage}-{N}`
/// - Per-stage numbering (matches DB UNIQUE constraint)
/// - Single source of truth for iteration state
pub struct IterationService {
    store: Arc<dyn WorkflowStore>,
}

impl IterationService {
    /// Create a new iteration service.
    pub fn new(store: Arc<dyn WorkflowStore>) -> Self {
        Self { store }
    }

    /// Create a new iteration for a task/stage.
    ///
    /// This is the ONLY way to create iterations - it enforces consistent
    /// ID format and per-stage numbering.
    ///
    /// # Arguments
    /// * `task_id` - The task this iteration belongs to
    /// * `stage` - The workflow stage (e.g., "planning", "work")
    /// * `trigger` - Optional context explaining why this iteration was created
    ///
    /// # Returns
    /// The newly created iteration
    #[allow(clippy::cast_possible_truncation)]
    pub fn create_iteration(
        &self,
        task_id: &str,
        stage: &str,
        trigger: Option<IterationTrigger>,
    ) -> WorkflowResult<Iteration> {
        // Validate inputs to prevent malformed iteration IDs
        if task_id.is_empty() || stage.is_empty() {
            return Err(crate::workflow::ports::WorkflowError::InvalidState(
                "task_id and stage must not be empty".into(),
            ));
        }

        let now = Utc::now().to_rfc3339();

        // Count existing iterations for THIS stage only
        // This matches the DB UNIQUE constraint: (task_id, stage, iteration_number)
        let all_iterations = self.store.get_iterations(task_id)?;
        let stage_count = all_iterations.iter().filter(|i| i.stage == stage).count() as u32;
        let next_num = stage_count + 1;

        // Consistent ID format: task-stage-N
        let id = format!("{task_id}-{stage}-{next_num}");

        let mut iteration = Iteration::new(&id, task_id, stage, next_num, &now);
        if let Some(ctx) = trigger {
            iteration = iteration.with_context(ctx);
        }

        self.store.save_iteration(&iteration)?;
        Ok(iteration)
    }

    /// Create the initial iteration when a task is first created.
    ///
    /// Convenience method that creates an iteration with no trigger context.
    pub fn create_initial_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Iteration> {
        self.create_iteration(task_id, stage, None)
    }

    /// End the active iteration with an outcome.
    ///
    /// Finds the active (unended) iteration for the task/stage and sets its
    /// outcome and end time.
    ///
    /// # Behavior
    ///
    /// If no active iteration exists for the task/stage, this method returns
    /// `Ok(())` silently. This is intentional to simplify callers that may
    /// transition through states where an iteration might or might not exist.
    /// Callers that need to ensure an iteration exists should verify with
    /// `get_active()` first or use `create_iteration()` to guarantee one exists.
    pub fn end_iteration(
        &self,
        task_id: &str,
        stage: &str,
        outcome: Outcome,
    ) -> WorkflowResult<()> {
        if let Some(mut iteration) = self.store.get_active_iteration(task_id, stage)? {
            iteration.end(Utc::now().to_rfc3339(), outcome);
            self.store.save_iteration(&iteration)?;
        }
        Ok(())
    }

    /// Get the active (unended) iteration for a task/stage.
    pub fn get_active(&self, task_id: &str, stage: &str) -> WorkflowResult<Option<Iteration>> {
        self.store.get_active_iteration(task_id, stage)
    }

    /// Set the activity log on the active iteration for a task/stage.
    ///
    /// Called before ending the iteration, when the agent output includes
    /// an `activity_log` field. If no active iteration exists, this is a no-op
    /// (same behavior as `end_iteration`).
    pub fn set_activity_log(
        &self,
        task_id: &str,
        stage: &str,
        activity_log: &str,
    ) -> WorkflowResult<()> {
        if let Some(mut iteration) = self.store.get_active_iteration(task_id, stage)? {
            iteration.activity_log = Some(activity_log.to_string());
            self.store.save_iteration(&iteration)?;
        }
        Ok(())
    }

    /// Set the artifact snapshot on the active iteration for a task/stage.
    ///
    /// Called when an agent produces artifact output, capturing the content
    /// at that point in time. If no active iteration exists, this is a no-op.
    pub fn set_artifact_snapshot(
        &self,
        task_id: &str,
        stage: &str,
        snapshot: ArtifactSnapshot,
    ) -> WorkflowResult<()> {
        if let Some(mut iteration) = self.store.get_active_iteration(task_id, stage)? {
            iteration.artifact_snapshot = Some(snapshot);
            self.store.save_iteration(&iteration)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::domain::QuestionAnswer;

    fn create_service() -> IterationService {
        let store = Arc::new(InMemoryWorkflowStore::new());
        IterationService::new(store)
    }

    #[test]
    fn test_create_initial_iteration() {
        let service = create_service();

        let iteration = service
            .create_initial_iteration("task-1", "planning")
            .unwrap();

        assert_eq!(iteration.id, "task-1-planning-1");
        assert_eq!(iteration.task_id, "task-1");
        assert_eq!(iteration.stage, "planning");
        assert_eq!(iteration.iteration_number, 1);
        assert!(iteration.incoming_context.is_none());
    }

    #[test]
    fn test_create_iteration_with_trigger() {
        let service = create_service();

        // Create first iteration
        service
            .create_initial_iteration("task-1", "planning")
            .unwrap();

        // Create second iteration with feedback trigger
        let iteration = service
            .create_iteration(
                "task-1",
                "planning",
                Some(IterationTrigger::Feedback {
                    feedback: "Please try again".to_string(),
                }),
            )
            .unwrap();

        assert_eq!(iteration.id, "task-1-planning-2");
        assert_eq!(iteration.iteration_number, 2);
        assert!(matches!(
            iteration.incoming_context,
            Some(IterationTrigger::Feedback { .. })
        ));
    }

    #[test]
    fn test_per_stage_numbering() {
        let service = create_service();

        // Create iterations in planning stage
        let p1 = service
            .create_initial_iteration("task-1", "planning")
            .unwrap();
        let p2 = service
            .create_iteration("task-1", "planning", None)
            .unwrap();

        // Create iteration in work stage - should start at 1, not 3
        let w1 = service.create_initial_iteration("task-1", "work").unwrap();

        assert_eq!(p1.iteration_number, 1);
        assert_eq!(p2.iteration_number, 2);
        assert_eq!(w1.iteration_number, 1); // Per-stage numbering!
        assert_eq!(w1.id, "task-1-work-1");
    }

    #[test]
    fn test_end_iteration() {
        let service = create_service();

        service
            .create_initial_iteration("task-1", "planning")
            .unwrap();

        service
            .end_iteration("task-1", "planning", Outcome::Approved)
            .unwrap();

        let iteration = service.get_active("task-1", "planning").unwrap();
        assert!(iteration.is_none()); // No longer active after ending
    }

    #[test]
    fn test_end_iteration_nonexistent_succeeds() {
        // Verify the documented "silent success" behavior when no iteration exists
        let service = create_service();

        // End an iteration that was never created - should succeed silently
        let result = service.end_iteration("nonexistent-task", "planning", Outcome::Approved);
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_iteration_rejects_empty_inputs() {
        let service = create_service();

        // Empty task_id should fail
        let result = service.create_iteration("", "planning", None);
        assert!(result.is_err());

        // Empty stage should fail
        let result = service.create_iteration("task-1", "", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_iteration_triggers() {
        let service = create_service();

        // Test various trigger types
        let triggers = vec![
            IterationTrigger::Feedback {
                feedback: "Try again".to_string(),
            },
            IterationTrigger::Answers {
                answers: vec![QuestionAnswer::new("Q?", "A", "2024-01-01T00:00:00Z")],
            },
            IterationTrigger::Integration {
                message: "Conflict".to_string(),
                conflict_files: vec!["file.rs".to_string()],
            },
            IterationTrigger::Rejection {
                from_stage: "work".to_string(),
                feedback: "Back to planning".to_string(),
            },
            IterationTrigger::Interrupted,
        ];

        for (i, trigger) in triggers.into_iter().enumerate() {
            let stage = format!("stage-{i}");
            let iteration = service
                .create_iteration("task-1", &stage, Some(trigger.clone()))
                .unwrap();

            assert!(iteration.incoming_context.is_some());
        }
    }
}

#[cfg(test)]
mod activity_log_tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;

    #[test]
    fn test_set_activity_log() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = IterationService::new(store.clone());

        // Create an active iteration
        service.create_initial_iteration("task-1", "work").unwrap();

        // Set activity log
        service
            .set_activity_log("task-1", "work", "Implemented the feature")
            .unwrap();

        // Verify it was set
        let iteration = service.get_active("task-1", "work").unwrap().unwrap();
        assert_eq!(
            iteration.activity_log,
            Some("Implemented the feature".to_string())
        );
    }

    #[test]
    fn test_set_activity_log_no_active_iteration() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = IterationService::new(store);

        // Should not error when no iteration exists
        let result = service.set_activity_log("nonexistent", "work", "Some log");
        assert!(result.is_ok());
    }
}

#[cfg(test)]
mod artifact_snapshot_tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::domain::ArtifactSnapshot;

    #[test]
    fn test_set_artifact_snapshot() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = IterationService::new(store.clone());

        service.create_initial_iteration("task-1", "work").unwrap();

        let snapshot = ArtifactSnapshot {
            name: "summary".to_string(),
            content: "## Work done\n\nImplemented feature X.".to_string(),
        };
        service
            .set_artifact_snapshot("task-1", "work", snapshot.clone())
            .unwrap();

        let iteration = service.get_active("task-1", "work").unwrap().unwrap();
        assert_eq!(iteration.artifact_snapshot, Some(snapshot));
    }

    #[test]
    fn test_set_artifact_snapshot_no_active_iteration() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = IterationService::new(store);

        let snapshot = ArtifactSnapshot {
            name: "plan".to_string(),
            content: "# Plan".to_string(),
        };
        // Should not error when no iteration exists
        let result = service.set_artifact_snapshot("nonexistent", "work", snapshot);
        assert!(result.is_ok());
    }
}
