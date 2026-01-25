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

use crate::workflow::domain::{SessionState, StageSession};
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

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

    /// Record that an agent was started.
    ///
    /// Creates or updates the session with the agent PID.
    /// Call this immediately after spawning the agent process.
    pub fn on_agent_started(
        &self,
        task_id: &str,
        stage: &str,
        pid: u32,
    ) -> WorkflowResult<()> {
        let now = chrono::Utc::now().to_rfc3339();

        let session = match self.store.get_stage_session(task_id, stage)? {
            Some(mut session) => {
                // Update existing session
                session.agent_pid = Some(pid);
                session.resume_count += 1;
                session.updated_at = now;
                session
            }
            None => {
                // Create new session
                let id = format!("{}-{}", task_id, stage);
                let mut session = StageSession::new(id, task_id, stage, &now);
                session.agent_pid = Some(pid);
                session
            }
        };

        self.store.save_stage_session(&session)
    }

    /// Record the Claude session ID.
    ///
    /// Called when the session ID is captured from the agent's output stream.
    /// Only the first session ID is recorded (subsequent calls are ignored).
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
            }
            None => {
                // Create session with ID (edge case: session ID before agent_started)
                let id = format!("{}-{}", task_id, stage);
                let mut session = StageSession::new(id, task_id, stage, &now);
                session.claude_session_id = Some(session_id.to_string());
                self.store.save_stage_session(&session)?;
            }
        }

        Ok(())
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
        let service = create_service();

        // Start agent
        service.on_agent_started("task-1", "planning", 12345).unwrap();

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
        let service = create_service();

        // Start and complete session
        service.on_agent_started("task-1", "planning", 12345).unwrap();
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
        let service = create_service();

        // Start and abandon session
        service.on_agent_started("task-1", "planning", 12345).unwrap();
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
        let service = create_service();

        // Start agent
        service.on_agent_started("task-1", "planning", 12345).unwrap();

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
        let service = create_service();

        // Task 1 has running agent
        service.on_agent_started("task-1", "planning", 12345).unwrap();

        // Task 2 agent finished
        service.on_agent_started("task-2", "planning", 12346).unwrap();
        service.on_agent_exited("task-2", "planning").unwrap();

        let running = service.get_running_agents().unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].0, "task-1");
        assert_eq!(running[0].2, 12345);
    }
}
