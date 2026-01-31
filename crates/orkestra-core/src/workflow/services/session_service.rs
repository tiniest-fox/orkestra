//! Session management service.
//!
//! This service manages Claude session continuity across agent spawns.
//! It tracks which Claude session ID is associated with each task+stage,
//! enabling resume functionality when agents are restarted.
//!
//! The service is responsible for:
//! - Providing spawn context (resume session ID) before spawning
//! - Ensuring an iteration exists before spawning (delegates to `IterationService`)
//! - Recording agent PIDs when agents start
//! - Recording Claude session IDs when captured from output
//! - Clearing PIDs when agents exit
//! - Completing/abandoning sessions on stage transitions

use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::domain::{SessionState, StageSession};
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Outcome;

use super::IterationService;

// ============================================================================
// Spawn Context
// ============================================================================

/// Context needed before spawning an agent.
///
/// The session ID is always present (generated at session creation).
/// Use `is_resume` to determine whether to pass `--session-id` or `--resume` to Claude.
#[derive(Debug, Clone)]
pub struct SessionSpawnContext {
    /// The Claude session ID. Always present (generated when session is created).
    pub session_id: String,
    /// Whether this is a resume (use `--resume`) or first spawn (use `--session-id`).
    /// Based on `spawn_count > 0` - if the agent has previously been spawned, it's a resume.
    pub is_resume: bool,
}

// ============================================================================
// Session Service
// ============================================================================

/// Service for managing Claude session lifecycle.
///
/// This service tracks Claude sessions across agent spawns, enabling
/// resume functionality when agents are restarted. Each task+stage
/// combination gets a single session that persists across rejections
/// and retries.
pub struct SessionService {
    store: Arc<dyn WorkflowStore>,
    iteration_service: Arc<IterationService>,
}

impl SessionService {
    /// Create a new session service with the given store and iteration service.
    pub fn new(store: Arc<dyn WorkflowStore>, iteration_service: Arc<IterationService>) -> Self {
        Self {
            store,
            iteration_service,
        }
    }

    /// Get spawn context before launching an agent.
    ///
    /// Returns the session ID and whether this is a resume.
    /// The session must exist and be in Active or Spawning state.
    ///
    /// # Errors
    ///
    /// Returns `StageSessionNotFound` if no session exists for this task+stage.
    /// Returns `InvalidState` if the session exists but has no `claude_session_id`
    /// (should never happen - sessions are created with a UUID).
    pub fn get_spawn_context(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<SessionSpawnContext> {
        match self.store.get_stage_session(task_id, stage)? {
            Some(session)
                if session.session_state == SessionState::Active
                    || session.session_state == SessionState::Spawning =>
            {
                // Session must have a claude_session_id (generated at creation)
                let session_id = session.claude_session_id.ok_or_else(|| {
                    crate::workflow::ports::WorkflowError::InvalidState(format!(
                        "Session {task_id}/{stage} exists but has no claude_session_id - this is a bug"
                    ))
                })?;

                // It's a resume if the agent has previously been spawned (spawn_count > 0)
                let is_resume = session.spawn_count > 0;

                orkestra_debug!(
                    "session",
                    "get_spawn_context {}/{}: session_id={}, is_resume={}, spawn_count={}",
                    task_id,
                    stage,
                    session_id,
                    is_resume,
                    session.spawn_count
                );

                Ok(SessionSpawnContext {
                    session_id,
                    is_resume,
                })
            }
            Some(_) => {
                // Session exists but is Completed or Abandoned
                Err(crate::workflow::ports::WorkflowError::StageSessionNotFound(
                    format!("{task_id}/{stage} - session is not active"),
                ))
            }
            None => {
                // No session exists - caller should call on_spawn_starting first
                Err(crate::workflow::ports::WorkflowError::StageSessionNotFound(
                    format!("{task_id}/{stage} - call on_spawn_starting first"),
                ))
            }
        }
    }
    // ========================================================================
    // Spawn Lifecycle Methods
    // ========================================================================

    /// Create session and iteration before spawn attempt.
    ///
    /// This is called BEFORE attempting to spawn the agent process.
    /// Creates or updates a session in `Spawning` state.
    /// Creates a new iteration only if there's no active one for this stage.
    /// Returns the iteration ID for tracking.
    ///
    /// # Panics
    ///
    /// Panics if session ID is missing after being set (should never happen).
    pub fn on_spawn_starting(&self, task_id: &str, stage: &str) -> WorkflowResult<String> {
        let now = chrono::Utc::now().to_rfc3339();
        let session_id = format!("{task_id}-{stage}");

        // Get or create session in Spawning state
        let session = if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            // Existing session - transition to Spawning
            // Ensure session ID exists (might be missing from older sessions or bugs)
            if session
                .claude_session_id
                .as_ref()
                .is_none_or(String::is_empty)
            {
                session.claude_session_id = Some(uuid::Uuid::new_v4().to_string());
                orkestra_debug!(
                    "session",
                    "on_spawn_starting {}/{}: regenerated missing session_id={}",
                    task_id,
                    stage,
                    session.claude_session_id.as_ref().unwrap()
                );
            }
            session.session_state = SessionState::Spawning;
            session.updated_at.clone_from(&now);
            session
        } else {
            // New session in Spawning state
            let mut session = StageSession::new(&session_id, task_id, stage, &now);
            session.session_state = SessionState::Spawning;
            session
        };

        orkestra_debug!(
            "session",
            "on_spawn_starting {}/{}: claude_session_id={:?}, state={:?}, spawn_count={}",
            task_id,
            stage,
            session.claude_session_id,
            session.session_state,
            session.spawn_count
        );

        self.store.save_stage_session(&session)?;

        // Get or create iteration - same logical flow as before, but delegates to IterationService
        let iteration =
            if let Some(active_iter) = self.store.get_active_iteration(task_id, stage)? {
                active_iter
            } else {
                // No active iteration exists - create one via IterationService
                // This maintains the original behavior where an iteration is always
                // created before spawning the agent
                orkestra_debug!(
                    "session",
                    "on_spawn_starting {}/{}: creating iteration via IterationService",
                    task_id,
                    stage
                );
                self.iteration_service
                    .create_iteration(task_id, stage, None)?
            };

        // Link the session to the iteration for log recovery
        let iteration = iteration.with_stage_session_id(&session_id);
        self.store.save_iteration(&iteration)?;

        Ok(iteration.id)
    }

    /// Update session after successful spawn.
    ///
    /// Transitions session from `Spawning` to `Active`, records PID, and increments
    /// `spawn_count` so that if the agent crashes, the next spawn uses `--resume`.
    ///
    /// # Errors
    ///
    /// Returns an error if no session exists (`on_spawn_starting` should have been called first).
    pub fn on_agent_spawned(&self, task_id: &str, stage: &str, pid: u32) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();

        let mut session = self
            .store
            .get_stage_session(task_id, stage)?
            .ok_or_else(|| {
                crate::workflow::ports::WorkflowError::StageSessionNotFound(format!(
                    "{task_id}/{stage} - on_spawn_starting must be called first"
                ))
            })?;

        session.session_state = SessionState::Active;
        session.agent_spawned(pid, &now);

        orkestra_debug!(
            "session",
            "on_agent_spawned {}/{}: pid={}, spawn_count={}, claude_session_id={:?}",
            task_id,
            stage,
            pid,
            session.spawn_count,
            session.claude_session_id
        );

        self.store.save_stage_session(&session)
    }

    /// Mark the iteration's trigger as delivered to the agent.
    ///
    /// Called after a successful resume spawn so that if the agent crashes again,
    /// the next resume uses "Your session was interrupted" instead of replaying
    /// the original trigger (e.g., script failure details the agent already received).
    pub fn mark_trigger_delivered(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        if let Some(mut iter) = self.store.get_active_iteration(task_id, stage)? {
            if !iter.trigger_delivered && iter.incoming_context.is_some() {
                orkestra_debug!(
                    "session",
                    "mark_trigger_delivered {}/{}: marking trigger as delivered",
                    task_id,
                    stage
                );
                iter.trigger_delivered = true;
                self.store.save_iteration(&iter)?;
            }
        }
        Ok(())
    }

    /// Record spawn failure in iteration.
    ///
    /// Sets the current iteration's outcome to `SpawnFailed` and transitions
    /// session back to `Active` (ready for retry).
    ///
    /// # Errors
    ///
    /// Returns an error if no session exists (`on_spawn_starting` should have been called first).
    pub fn on_spawn_failed(&self, task_id: &str, stage: &str, error: &str) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();

        // Update session state to Active (ready for retry)
        let mut session = self
            .store
            .get_stage_session(task_id, stage)?
            .ok_or_else(|| {
                crate::workflow::ports::WorkflowError::StageSessionNotFound(format!(
                    "{task_id}/{stage} - on_spawn_starting must be called first"
                ))
            })?;

        session.session_state = SessionState::Active;
        session.updated_at.clone_from(&now);
        self.store.save_stage_session(&session)?;

        // Find and end the active iteration with SpawnFailed outcome
        if let Some(mut iteration) = self.store.get_active_iteration(task_id, stage)? {
            iteration.end(
                &now,
                Outcome::SpawnFailed {
                    error: error.to_string(),
                },
            );
            self.store.save_iteration(&iteration)?;
        }

        Ok(())
    }

    /// Record that the agent process exited.
    ///
    /// Clears the PID and keeps the session active for potential resume.
    /// Note: `spawn_count` was already incremented at spawn time in `on_agent_spawned()`.
    pub fn on_agent_exited(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            let now = chrono::Utc::now().to_rfc3339();
            session.agent_finished(&now);

            orkestra_debug!(
                "session",
                "on_agent_exited {}/{}: spawn_count now {}, claude_session_id={:?}",
                task_id,
                stage,
                session.spawn_count,
                session.claude_session_id
            );

            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Mark the stage session as completed.
    ///
    /// Called when the stage is approved and we're moving to the next stage.
    /// Completed sessions cannot be resumed.
    pub fn on_stage_completed(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        orkestra_debug!("session", "on_stage_completed {}/{}", task_id, stage);

        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.session_state = SessionState::Completed;
            session.agent_pid = None;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Mark the stage session as abandoned.
    ///
    /// Called when the task fails, is blocked, or the stage is restaged.
    /// Abandoned sessions cannot be resumed.
    pub fn on_stage_abandoned(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        orkestra_debug!("session", "on_stage_abandoned {}/{}", task_id, stage);

        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.session_state = SessionState::Abandoned;
            session.agent_pid = None;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Get all sessions with running agents.
    ///
    /// Returns `(task_id, stage, pid)` tuples for sessions that have PIDs.
    /// Used for orphan cleanup on startup.
    pub fn get_running_agents(&self) -> WorkflowResult<Vec<(String, String, u32)>> {
        let sessions = self.store.get_sessions_with_pids()?;
        Ok(sessions
            .into_iter()
            .filter_map(|s| s.agent_pid.map(|pid| (s.task_id, s.stage, pid)))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;

    fn create_service() -> (SessionService, Arc<InMemoryWorkflowStore>) {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let iteration_service = Arc::new(IterationService::new(
            Arc::clone(&store) as Arc<dyn WorkflowStore>
        ));
        let session_service = SessionService::new(
            Arc::clone(&store) as Arc<dyn WorkflowStore>,
            iteration_service,
        );
        (session_service, store)
    }

    #[test]
    fn test_get_spawn_context_no_session() {
        let (service, _store) = create_service();

        // No session exists yet - should error
        let result = service.get_spawn_context("task-1", "planning");
        assert!(result.is_err());
    }

    #[test]
    fn test_spawn_context_first_spawn() {
        let (service, _store) = create_service();

        // Create session (simulates on_spawn_starting)
        // This will also create an iteration via IterationService
        service.on_spawn_starting("task-1", "planning").unwrap();

        // Get context for first spawn
        let ctx = service.get_spawn_context("task-1", "planning").unwrap();

        // Should have session ID but not be a resume
        assert!(!ctx.session_id.is_empty());
        assert!(!ctx.is_resume); // spawn_count is 0
    }

    #[test]
    fn test_spawn_context_with_resume() {
        let (service, _store) = create_service();

        // Start agent
        service.on_spawn_starting("task-1", "planning").unwrap();
        let first_ctx = service.get_spawn_context("task-1", "planning").unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();

        // Agent exits (spawn_count was already incremented in on_agent_spawned)
        service.on_agent_exited("task-1", "planning").unwrap();

        // Next spawn should be a resume with SAME session ID (spawn_count > 0)
        service.on_spawn_starting("task-1", "planning").unwrap();
        let ctx = service.get_spawn_context("task-1", "planning").unwrap();
        assert_eq!(ctx.session_id, first_ctx.session_id); // Same session ID
        assert!(ctx.is_resume); // spawn_count > 0
    }

    #[test]
    fn test_completed_session_no_resume() {
        let (service, _store) = create_service();

        // Start and complete session
        service.on_spawn_starting("task-1", "planning").unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();
        service.on_stage_completed("task-1", "planning").unwrap();

        // Completed sessions should error on get_spawn_context
        let result = service.get_spawn_context("task-1", "planning");
        assert!(result.is_err());
    }

    #[test]
    fn test_abandoned_session_no_resume() {
        let (service, _store) = create_service();

        // Start and abandon session
        service.on_spawn_starting("task-1", "planning").unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();
        service.on_stage_abandoned("task-1", "planning").unwrap();

        // Abandoned sessions should error on get_spawn_context
        let result = service.get_spawn_context("task-1", "planning");
        assert!(result.is_err());
    }

    #[test]
    fn test_session_id_generated_upfront() {
        let (service, store) = create_service();

        // Create session
        service.on_spawn_starting("task-1", "planning").unwrap();

        // Session should have a UUID already
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert!(session.claude_session_id.is_some());

        // Context should have the same session ID
        let ctx = service.get_spawn_context("task-1", "planning").unwrap();
        assert_eq!(Some(ctx.session_id), session.claude_session_id);
    }

    #[test]
    fn test_get_running_agents() {
        let (service, _store) = create_service();

        // Task 1 has running agent
        service.on_spawn_starting("task-1", "planning").unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();

        // Task 2 agent finished
        service.on_spawn_starting("task-2", "planning").unwrap();
        service
            .on_agent_spawned("task-2", "planning", 12346)
            .unwrap();
        service.on_agent_exited("task-2", "planning").unwrap();

        let running = service.get_running_agents().unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].0, "task-1");
        assert_eq!(running[0].2, 12345);
    }

    // ========================================================================
    // Spawn Lifecycle Tests
    // ========================================================================

    #[test]
    fn test_spawn_starting_creates_session_and_iteration() {
        let (service, store) = create_service();

        // on_spawn_starting creates both session and iteration (via IterationService)
        let iter_id = service.on_spawn_starting("task-1", "planning").unwrap();

        // Session should be in Spawning state
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session.session_state, SessionState::Spawning);

        // Iteration should exist, be active, and have the session linked
        let iteration = store
            .get_active_iteration("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(iteration.id, iter_id);
        assert!(iteration.is_active());
        // Session should be linked to iteration
        assert!(iteration.stage_session_id.is_some());
    }

    #[test]
    fn test_spawn_starting_reuses_existing_iteration() {
        let (service, store) = create_service();

        // First call creates iteration
        let iter_id_1 = service.on_spawn_starting("task-1", "planning").unwrap();
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();
        service.on_agent_exited("task-1", "planning").unwrap();

        // Second call should reuse the same iteration (it's still active)
        let iter_id_2 = service.on_spawn_starting("task-1", "planning").unwrap();
        assert_eq!(iter_id_1, iter_id_2);

        // Should still be only one iteration
        let iterations = store.get_iterations("task-1").unwrap();
        assert_eq!(iterations.len(), 1);
    }

    #[test]
    fn test_agent_spawned_transitions_to_active() {
        let (service, store) = create_service();

        // Start spawn (creates session and iteration)
        service.on_spawn_starting("task-1", "planning").unwrap();

        // Spawn succeeded
        service
            .on_agent_spawned("task-1", "planning", 12345)
            .unwrap();

        // Session should be Active with PID
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session.session_state, SessionState::Active);
        assert_eq!(session.agent_pid, Some(12345));
    }

    #[test]
    fn test_spawn_failed_records_outcome() {
        let (service, store) = create_service();

        // Start spawn (creates session and iteration)
        service.on_spawn_starting("task-1", "planning").unwrap();

        // Spawn failed
        service
            .on_spawn_failed("task-1", "planning", "Process not found")
            .unwrap();

        // Session should be Active (ready for retry)
        let session = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(session.session_state, SessionState::Active);

        // Iteration should have SpawnFailed outcome
        let iterations = store.get_iterations("task-1").unwrap();
        let iteration = iterations.iter().find(|i| i.stage == "planning").unwrap();
        assert!(!iteration.is_active());

        match iteration.outcome.as_ref().unwrap() {
            Outcome::SpawnFailed { error } => {
                assert_eq!(error, "Process not found");
            }
            other => panic!("Expected SpawnFailed, got {other:?}"),
        }
    }

    #[test]
    fn test_spawn_failed_retry_is_not_resume() {
        // Verifies that if a spawn FAILS (process never started), the retry
        // should NOT use --resume because no Claude session file was created.
        // This is correct because spawn_count is only incremented in on_agent_spawned,
        // which is never called when spawn fails.
        let (service, _store) = create_service();

        // Start spawn attempt
        service.on_spawn_starting("task-1", "planning").unwrap();

        // Spawn fails before process starts (on_agent_spawned never called)
        service
            .on_spawn_failed("task-1", "planning", "Process not found")
            .unwrap();

        // Retry: get spawn context again
        service.on_spawn_starting("task-1", "planning").unwrap();
        let ctx = service.get_spawn_context("task-1", "planning").unwrap();

        // Should NOT be a resume because on_agent_spawned was never called
        assert!(
            !ctx.is_resume,
            "Retry after failed spawn should not be a resume (no Claude session exists)"
        );
    }

    // ========================================================================
    // Trigger Delivery Tests
    // ========================================================================

    #[test]
    fn test_mark_trigger_delivered() {
        let (service, store) = create_service();
        use crate::workflow::domain::IterationTrigger;

        // Create session and iteration
        service.on_spawn_starting("task-1", "work").unwrap();

        // Set a trigger on the active iteration
        let mut iter = store.get_active_iteration("task-1", "work").unwrap().unwrap();
        iter.incoming_context = Some(IterationTrigger::ScriptFailure {
            from_stage: "checks".into(),
            error: "test failed".into(),
        });
        store.save_iteration(&iter).unwrap();

        // Before marking: trigger_delivered should be false
        let iter = store.get_active_iteration("task-1", "work").unwrap().unwrap();
        assert!(!iter.trigger_delivered);

        // Mark trigger as delivered
        service.mark_trigger_delivered("task-1", "work").unwrap();

        // After marking: trigger_delivered should be true, but incoming_context preserved
        let iter = store.get_active_iteration("task-1", "work").unwrap().unwrap();
        assert!(iter.trigger_delivered);
        assert!(matches!(
            iter.incoming_context,
            Some(IterationTrigger::ScriptFailure { .. })
        ));
    }

    #[test]
    fn test_mark_trigger_delivered_noop_when_already_delivered() {
        let (service, store) = create_service();
        use crate::workflow::domain::IterationTrigger;

        service.on_spawn_starting("task-1", "work").unwrap();

        // Set trigger and mark as delivered
        let mut iter = store.get_active_iteration("task-1", "work").unwrap().unwrap();
        iter.incoming_context = Some(IterationTrigger::Feedback {
            feedback: "fix this".into(),
        });
        iter.trigger_delivered = true;
        store.save_iteration(&iter).unwrap();

        // Calling again should be a no-op
        service.mark_trigger_delivered("task-1", "work").unwrap();

        let iter = store.get_active_iteration("task-1", "work").unwrap().unwrap();
        assert!(iter.trigger_delivered);
    }

    #[test]
    fn test_mark_trigger_delivered_noop_when_no_trigger() {
        let (service, store) = create_service();

        service.on_spawn_starting("task-1", "work").unwrap();

        // No incoming_context set (None)
        let iter = store.get_active_iteration("task-1", "work").unwrap().unwrap();
        assert!(iter.incoming_context.is_none());

        // Should succeed without marking (nothing to deliver)
        service.mark_trigger_delivered("task-1", "work").unwrap();

        let iter = store.get_active_iteration("task-1", "work").unwrap().unwrap();
        assert!(!iter.trigger_delivered);
    }
}
