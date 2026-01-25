//! Stage session tracking for workflow stages.
//!
//! A StageSession wraps all iterations for a given task+stage combination,
//! maintaining Claude session continuity across rejections and crash recovery.

use serde::{Deserialize, Serialize};

/// State of a StageSession.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    /// Session created, spawn in progress. Transitions to Active on success.
    Spawning,

    /// Session is active - agent may be running or waiting to resume.
    #[default]
    Active,

    /// Session completed successfully (stage approved, moved to next stage).
    Completed,

    /// Session was abandoned (task failed, blocked, or stage restaged from).
    Abandoned,
}

/// A session wrapper that maintains Claude session continuity across iterations within a stage.
///
/// All iterations for a given task+stage share a single StageSession. The session
/// survives across rejections, questions, and crash recovery. When work is rejected,
/// the rejection feedback is passed as a continuation message to the same Claude session
/// rather than starting a new session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageSession {
    /// Unique identifier for this session.
    pub id: String,

    /// ID of the task this session belongs to.
    pub task_id: String,

    /// Stage name (e.g., "planning", "work", "review").
    pub stage: String,

    /// Claude session ID for --resume flag. Captured from first spawn, reused on all subsequent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,

    /// Currently running agent process ID (if any).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_pid: Option<u32>,

    /// Number of times the session has been resumed (for UI markers).
    #[serde(default)]
    pub resume_count: u32,

    /// Current state of the session.
    #[serde(default)]
    pub session_state: SessionState,

    /// When this session was first created (RFC3339).
    pub created_at: String,

    /// When the session was last active (RFC3339).
    pub updated_at: String,
}

impl StageSession {
    /// Create a new stage session.
    pub fn new(
        id: impl Into<String>,
        task_id: impl Into<String>,
        stage: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Self {
        let created = created_at.into();
        Self {
            id: id.into(),
            task_id: task_id.into(),
            stage: stage.into(),
            claude_session_id: None,
            agent_pid: None,
            resume_count: 0,
            session_state: SessionState::Active,
            created_at: created.clone(),
            updated_at: created,
        }
    }

    /// Check if this session has a Claude session ID (can be resumed).
    pub fn can_resume(&self) -> bool {
        self.claude_session_id.is_some() && self.session_state == SessionState::Active
    }

    /// Check if an agent is currently running.
    pub fn has_agent(&self) -> bool {
        self.agent_pid.is_some()
    }

    /// Check if the session is still active.
    pub fn is_active(&self) -> bool {
        self.session_state == SessionState::Active
    }

    /// Mark the session as completed (stage approved).
    pub fn complete(&mut self, updated_at: impl Into<String>) {
        self.session_state = SessionState::Completed;
        self.agent_pid = None;
        self.updated_at = updated_at.into();
    }

    /// Mark the session as abandoned (task failed, blocked, or restaged).
    pub fn abandon(&mut self, updated_at: impl Into<String>) {
        self.session_state = SessionState::Abandoned;
        self.agent_pid = None;
        self.updated_at = updated_at.into();
    }

    /// Record that an agent was spawned.
    pub fn agent_spawned(
        &mut self,
        pid: u32,
        claude_session_id: Option<String>,
        updated_at: impl Into<String>,
    ) {
        self.agent_pid = Some(pid);
        // Only set session_id on first spawn
        if self.claude_session_id.is_none() {
            self.claude_session_id = claude_session_id;
        } else {
            // This is a resume
            self.resume_count += 1;
        }
        self.updated_at = updated_at.into();
    }

    /// Record that the agent finished (process ended).
    pub fn agent_finished(&mut self, updated_at: impl Into<String>) {
        self.agent_pid = None;
        self.updated_at = updated_at.into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stage_session_new() {
        let session = StageSession::new("ss-1", "task-1", "planning", "2025-01-24T10:00:00Z");

        assert_eq!(session.id, "ss-1");
        assert_eq!(session.task_id, "task-1");
        assert_eq!(session.stage, "planning");
        assert!(session.claude_session_id.is_none());
        assert!(session.agent_pid.is_none());
        assert_eq!(session.resume_count, 0);
        assert!(session.is_active());
        assert!(!session.can_resume());
    }

    #[test]
    fn test_agent_spawned_first_time() {
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");

        session.agent_spawned(12345, Some("claude-session-abc".into()), "later");

        assert_eq!(session.agent_pid, Some(12345));
        assert_eq!(session.claude_session_id, Some("claude-session-abc".into()));
        assert_eq!(session.resume_count, 0); // First spawn, not a resume
        assert!(session.has_agent());
        assert!(session.can_resume());
    }

    #[test]
    fn test_agent_spawned_resume() {
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");

        // First spawn
        session.agent_spawned(12345, Some("claude-session-abc".into()), "t1");
        session.agent_finished("t2");

        // Resume spawn
        session.agent_spawned(12346, Some("claude-session-xyz".into()), "t3");

        assert_eq!(session.agent_pid, Some(12346));
        // Should keep original session_id
        assert_eq!(session.claude_session_id, Some("claude-session-abc".into()));
        assert_eq!(session.resume_count, 1); // Incremented on resume
    }

    #[test]
    fn test_session_complete() {
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");
        session.agent_spawned(12345, Some("abc".into()), "t1");

        session.complete("t2");

        assert_eq!(session.session_state, SessionState::Completed);
        assert!(session.agent_pid.is_none());
        assert!(!session.is_active());
        assert!(!session.can_resume()); // Can't resume completed session
    }

    #[test]
    fn test_session_abandon() {
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");

        session.abandon("later");

        assert_eq!(session.session_state, SessionState::Abandoned);
        assert!(!session.is_active());
    }

    #[test]
    fn test_serialization() {
        let mut session = StageSession::new("ss-1", "task-1", "work", "2025-01-24T10:00:00Z");
        session.claude_session_id = Some("claude-abc".into());
        session.resume_count = 2;

        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("\"id\":\"ss-1\""));
        assert!(json.contains("\"claude_session_id\":\"claude-abc\""));
        assert!(json.contains("\"resume_count\":2"));

        let parsed: StageSession = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, session);
    }

    #[test]
    fn test_session_state_serialization() {
        let spawning = SessionState::Spawning;
        let active = SessionState::Active;
        let completed = SessionState::Completed;
        let abandoned = SessionState::Abandoned;

        assert_eq!(serde_json::to_string(&spawning).unwrap(), "\"spawning\"");
        assert_eq!(serde_json::to_string(&active).unwrap(), "\"active\"");
        assert_eq!(serde_json::to_string(&completed).unwrap(), "\"completed\"");
        assert_eq!(serde_json::to_string(&abandoned).unwrap(), "\"abandoned\"");
    }

    #[test]
    fn test_spawning_state_not_resumable() {
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");
        session.session_state = SessionState::Spawning;

        // Spawning sessions should not be resumable
        assert!(!session.can_resume());
        assert!(!session.is_active());
    }
}
