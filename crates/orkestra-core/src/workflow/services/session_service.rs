//! Session management service.
//!
//! This service manages Claude session continuity across agent spawns.
//! It tracks which Claude session ID is associated with each task+stage,
//! enabling resume functionality when agents are restarted.
//!
//! The service is responsible for:
//! - Providing spawn context (resume session ID) before spawning
//! - Recording agent PIDs when agents start
//! - Recording Claude session IDs when captured from output
//! - Clearing PIDs when agents exit
//! - Completing/abandoning sessions on stage transitions

use std::sync::Arc;

use crate::workflow::domain::{Iteration, SessionState, StageSession};
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Outcome;

// ============================================================================
// Spawn Context
// ============================================================================

/// Context needed before spawning an agent.
#[derive(Debug, Clone)]
pub struct SessionSpawnContext {
    /// The Claude session ID to resume, if continuing a previous session.
    pub resume_session_id: Option<String>,
    /// Whether this is a resume (for logging/UI purposes).
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
}

impl SessionService {
    /// Create a new session service with the given store.
    pub fn new(store: Arc<dyn WorkflowStore>) -> Self {
        Self { store }
    }

    /// Get spawn context before launching an agent.
    ///
    /// Returns the resume session ID if this stage has been started before
    /// and the session is still active.
    pub fn get_spawn_context(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<SessionSpawnContext> {
        match self.store.get_stage_session(task_id, stage)? {
            Some(session) if session.session_state == SessionState::Active => {
                // Existing active session - we're resuming
                let is_resume = session.claude_session_id.is_some();
                Ok(SessionSpawnContext {
                    resume_session_id: session.claude_session_id,
                    is_resume,
                })
            }
            _ => {
                // No session or abandoned - starting fresh
                Ok(SessionSpawnContext {
                    resume_session_id: None,
                    is_resume: false,
                })
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
    pub fn on_spawn_starting(&self, task_id: &str, stage: &str) -> WorkflowResult<String> {
        let now = chrono::Utc::now().to_rfc3339();
        let session_id = format!("{}-{}", task_id, stage);

        // Get or create session in Spawning state
        let session = match self.store.get_stage_session(task_id, stage)? {
            Some(mut session) => {
                // Existing session - transition to Spawning
                session.session_state = SessionState::Spawning;
                session.updated_at = now.clone();
                session
            }
            None => {
                // New session in Spawning state
                let mut session = StageSession::new(&session_id, task_id, stage, &now);
                session.session_state = SessionState::Spawning;
                session
            }
        };

        self.store.save_stage_session(&session)?;

        // Check for existing active iteration - reuse if present
        // (task creation already creates an initial iteration)
        if let Some(active_iter) = self.store.get_active_iteration(task_id, stage)? {
            return Ok(active_iter.id);
        }

        // No active iteration - create one for this spawn attempt
        let iterations = self.store.get_iterations(task_id)?;
        let stage_iterations: Vec<_> = iterations.iter().filter(|i| i.stage == stage).collect();
        let next_num = stage_iterations.len() as u32 + 1;

        let iteration_id = format!("{}-{}-iter-{}", task_id, stage, next_num);
        let iteration = Iteration::new(&iteration_id, task_id, stage, next_num, &now)
            .with_stage_session_id(&session_id);

        self.store.save_iteration(&iteration)?;

        Ok(iteration_id)
    }

    /// Update session after successful spawn.
    ///
    /// Transitions session from `Spawning` to `Active` and records PID.
    ///
    /// # Errors
    ///
    /// Returns an error if no session exists (on_spawn_starting should have been called first).
    pub fn on_agent_spawned(&self, task_id: &str, stage: &str, pid: u32) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();

        let mut session = self
            .store
            .get_stage_session(task_id, stage)?
            .ok_or_else(|| {
                crate::workflow::ports::WorkflowError::StageSessionNotFound(format!(
                    "{}/{} - on_spawn_starting must be called first",
                    task_id, stage
                ))
            })?;

        session.session_state = SessionState::Active;
        session.agent_pid = Some(pid);
        session.updated_at = now;
        self.store.save_stage_session(&session)
    }

    /// Record spawn failure in iteration.
    ///
    /// Sets the current iteration's outcome to `SpawnFailed` and transitions
    /// session back to `Active` (ready for retry).
    ///
    /// # Errors
    ///
    /// Returns an error if no session exists (on_spawn_starting should have been called first).
    pub fn on_spawn_failed(&self, task_id: &str, stage: &str, error: &str) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();

        // Update session state to Active (ready for retry)
        let mut session = self
            .store
            .get_stage_session(task_id, stage)?
            .ok_or_else(|| {
                crate::workflow::ports::WorkflowError::StageSessionNotFound(format!(
                    "{}/{} - on_spawn_starting must be called first",
                    task_id, stage
                ))
            })?;

        session.session_state = SessionState::Active;
        session.updated_at = now.clone();
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

    /// Record the Claude session ID.
    ///
    /// Called when the session ID is captured from the agent's output stream.
    /// Only the first session ID is recorded (subsequent calls are ignored).
    ///
    /// Note: Session must already exist (on_spawn_starting creates it before agent runs).
    /// If no session exists, this is logged as a warning but doesn't fail.
    pub fn on_session_id(
        &self,
        task_id: &str,
        stage: &str,
        session_id: &str,
    ) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();

        match self.store.get_stage_session(task_id, stage)? {
            Some(mut session) => {
                // Only set if not already set (first session ID wins)
                if session.claude_session_id.is_none() {
                    session.claude_session_id = Some(session_id.to_string());
                    session.updated_at = now;
                    self.store.save_stage_session(&session)?;
                }
                Ok(())
            }
            None => {
                // Session should exist - on_spawn_starting creates it before agent runs
                // Log warning but don't fail - session ID is informational
                eprintln!(
                    "[orkestra] WARNING: Received session ID for {}/{} but no session exists",
                    task_id, stage
                );
                Ok(())
            }
        }
    }

    /// Record that the agent process exited.
    ///
    /// Clears the PID but keeps the session active for potential resume.
    pub fn on_agent_exited(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        if let Some(mut session) = self.store.get_stage_session(task_id, stage)? {
            session.agent_pid = None;
            session.updated_at = chrono::Utc::now().to_rfc3339();
            self.store.save_stage_session(&session)?;
        }
        Ok(())
    }

    /// Mark the stage session as completed.
    ///
    /// Called when the stage is approved and we're moving to the next stage.
    /// Completed sessions cannot be resumed.
    pub fn on_stage_completed(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
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
    /// Returns (task_id, stage, pid) tuples for sessions that have PIDs.
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

    fn create_service() -> SessionService {
        let store = Arc::new(InMemoryWorkflowStore::new());
        SessionService::new(store)
    }

    #[test]
    fn test_get_spawn_context_fresh() {
        let service = create_service();

        let ctx = service.get_spawn_context("task-1", "planning").unwrap();

        assert!(ctx.resume_session_id.is_none());
        assert!(!ctx.is_resume);
    }

    #[test]
    fn test_spawn_context_with_resume() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store);

        // Start agent using new lifecycle
        service.on_spawn_starting("task-1", "planning").unwrap();
        service.on_agent_spawned("task-1", "planning", 12345).unwrap();

        // Record session ID
        service
            .on_session_id("task-1", "planning", "claude-session-abc")
            .unwrap();

        // Agent exits
        service.on_agent_exited("task-1", "planning").unwrap();

        // Next spawn should resume
        let ctx = service.get_spawn_context("task-1", "planning").unwrap();
        assert_eq!(ctx.resume_session_id, Some("claude-session-abc".to_string()));
        assert!(ctx.is_resume);
    }

    #[test]
    fn test_completed_session_no_resume() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store);

        // Start and complete session using new lifecycle
        service.on_spawn_starting("task-1", "planning").unwrap();
        service.on_agent_spawned("task-1", "planning", 12345).unwrap();
        service
            .on_session_id("task-1", "planning", "claude-session-abc")
            .unwrap();
        service.on_stage_completed("task-1", "planning").unwrap();

        // Completed sessions don't resume
        let ctx = service.get_spawn_context("task-1", "planning").unwrap();
        assert!(ctx.resume_session_id.is_none());
        assert!(!ctx.is_resume);
    }

    #[test]
    fn test_abandoned_session_no_resume() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store);

        // Start and abandon session using new lifecycle
        service.on_spawn_starting("task-1", "planning").unwrap();
        service.on_agent_spawned("task-1", "planning", 12345).unwrap();
        service
            .on_session_id("task-1", "planning", "claude-session-abc")
            .unwrap();
        service.on_stage_abandoned("task-1", "planning").unwrap();

        // Abandoned sessions don't resume
        let ctx = service.get_spawn_context("task-1", "planning").unwrap();
        assert!(ctx.resume_session_id.is_none());
        assert!(!ctx.is_resume);
    }

    #[test]
    fn test_first_session_id_wins() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store);

        // Start agent using new lifecycle
        service.on_spawn_starting("task-1", "planning").unwrap();
        service.on_agent_spawned("task-1", "planning", 12345).unwrap();

        // Record first session ID
        service
            .on_session_id("task-1", "planning", "first-session")
            .unwrap();

        // Try to record second - should be ignored
        service
            .on_session_id("task-1", "planning", "second-session")
            .unwrap();

        let ctx = service.get_spawn_context("task-1", "planning").unwrap();
        assert_eq!(ctx.resume_session_id, Some("first-session".to_string()));
    }

    #[test]
    fn test_get_running_agents() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store);

        // Task 1 has running agent
        service.on_spawn_starting("task-1", "planning").unwrap();
        service.on_agent_spawned("task-1", "planning", 12345).unwrap();

        // Task 2 agent finished
        service.on_spawn_starting("task-2", "planning").unwrap();
        service.on_agent_spawned("task-2", "planning", 12346).unwrap();
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
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store.clone());

        let iter_id = service.on_spawn_starting("task-1", "planning").unwrap();

        // Session should be in Spawning state
        let session = store.get_stage_session("task-1", "planning").unwrap().unwrap();
        assert_eq!(session.session_state, SessionState::Spawning);

        // Iteration should exist and be active
        let iteration = store.get_active_iteration("task-1", "planning").unwrap().unwrap();
        assert_eq!(iteration.id, iter_id);
        assert!(iteration.is_active());
    }

    #[test]
    fn test_agent_spawned_transitions_to_active() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store.clone());

        // Start spawn
        service.on_spawn_starting("task-1", "planning").unwrap();

        // Spawn succeeded
        service.on_agent_spawned("task-1", "planning", 12345).unwrap();

        // Session should be Active with PID
        let session = store.get_stage_session("task-1", "planning").unwrap().unwrap();
        assert_eq!(session.session_state, SessionState::Active);
        assert_eq!(session.agent_pid, Some(12345));
    }

    #[test]
    fn test_spawn_failed_records_outcome() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store.clone());

        // Start spawn
        service.on_spawn_starting("task-1", "planning").unwrap();

        // Spawn failed
        service.on_spawn_failed("task-1", "planning", "Process not found").unwrap();

        // Session should be Active (ready for retry)
        let session = store.get_stage_session("task-1", "planning").unwrap().unwrap();
        assert_eq!(session.session_state, SessionState::Active);

        // Iteration should have SpawnFailed outcome
        let iterations = store.get_iterations("task-1").unwrap();
        let iteration = iterations.iter().find(|i| i.stage == "planning").unwrap();
        assert!(!iteration.is_active());

        match iteration.outcome.as_ref().unwrap() {
            Outcome::SpawnFailed { error } => {
                assert_eq!(error, "Process not found");
            }
            other => panic!("Expected SpawnFailed, got {:?}", other),
        }
    }

    #[test]
    fn test_multiple_spawn_attempts() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = SessionService::new(store.clone());

        // First attempt - fails
        service.on_spawn_starting("task-1", "planning").unwrap();
        service.on_spawn_failed("task-1", "planning", "First failure").unwrap();

        // Second attempt - also fails
        service.on_spawn_starting("task-1", "planning").unwrap();
        service.on_spawn_failed("task-1", "planning", "Second failure").unwrap();

        // Third attempt - succeeds
        service.on_spawn_starting("task-1", "planning").unwrap();
        service.on_agent_spawned("task-1", "planning", 12345).unwrap();

        // Should have 3 iterations
        let iterations = store.get_iterations("task-1").unwrap();
        assert_eq!(iterations.len(), 3);

        // First two should have SpawnFailed outcomes
        assert!(matches!(iterations[0].outcome, Some(Outcome::SpawnFailed { .. })));
        assert!(matches!(iterations[1].outcome, Some(Outcome::SpawnFailed { .. })));

        // Third should still be active (agent running)
        assert!(iterations[2].is_active());
    }
}
