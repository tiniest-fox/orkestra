//! Stage session tracking for workflow stages.
//!
//! A `StageSession` wraps all iterations for a given task+stage combination,
//! maintaining Claude session continuity across rejections and crash recovery.

use serde::{Deserialize, Serialize};

/// State of a `StageSession`.
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

    /// Session was abandoned (task failed, blocked, or stage rejected from).
    Abandoned,
}

/// A session wrapper that maintains Claude session continuity across iterations within a stage.
///
/// All iterations for a given task+stage share a single `StageSession`. The session
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

    /// Claude session ID. Generated upfront at session creation so log polling can find
    /// the JSONL file immediately. Used with --session-id on first spawn, --resume on subsequent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,

    /// Currently running agent process ID (if any).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_pid: Option<u32>,

    /// Number of times an agent has been spawned for this session.
    /// Used to determine if the next spawn should use `--resume` (count > 0) or `--session-id` (count == 0).
    /// Incremented at spawn time (not exit time) so crashes still result in correct resume behavior.
    #[serde(default)]
    pub spawn_count: u32,

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
    ///
    /// The `claude_session_id` starts as `None`. For providers that accept caller-supplied
    /// session IDs (Claude Code), the caller sets it before spawn. For providers that
    /// generate their own IDs (OpenCode), it stays `None` until extracted from the output stream.
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
            spawn_count: 0,
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

    /// Mark the session as abandoned (task failed, blocked, or rejected).
    pub fn abandon(&mut self, updated_at: impl Into<String>) {
        self.session_state = SessionState::Abandoned;
        self.agent_pid = None;
        self.updated_at = updated_at.into();
    }

    /// Record that an agent was spawned.
    ///
    /// Increments `spawn_count` so that if the agent crashes, the next spawn
    /// knows to use `--resume` instead of `--session-id`. This is more robust
    /// than incrementing on exit, since crashes skip the exit handler.
    pub fn agent_spawned(&mut self, pid: u32, updated_at: impl Into<String>) {
        self.agent_pid = Some(pid);
        self.spawn_count += 1;
        self.updated_at = updated_at.into();
    }

    /// Record that the agent finished (process ended).
    ///
    /// Clears the PID. The `spawn_count` was already incremented at spawn time.
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
        // Session ID starts as None — set by caller for providers that need it
        assert!(session.claude_session_id.is_none());
        assert!(session.agent_pid.is_none());
        assert_eq!(session.spawn_count, 0);
        assert!(session.is_active());
        assert!(!session.can_resume()); // Can't resume without session ID
    }

    #[test]
    fn test_agent_spawned_first_time() {
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");
        // Simulate caller setting session ID (as Claude Code provider would)
        session.claude_session_id = Some("test-uuid".to_string());
        let original_session_id = session.claude_session_id.clone();

        session.agent_spawned(12345, "later");

        assert_eq!(session.agent_pid, Some(12345));
        // Session ID should remain unchanged
        assert_eq!(session.claude_session_id, original_session_id);
        // spawn_count incremented on spawn so crashes still result in --resume
        assert_eq!(session.spawn_count, 1);
        assert!(session.has_agent());
        assert!(session.can_resume());
    }

    #[test]
    fn test_spawn_count_increments_on_spawn() {
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");
        session.claude_session_id = Some("test-uuid".to_string());
        let original_session_id = session.claude_session_id.clone();

        // First spawn - increments spawn_count immediately
        session.agent_spawned(12345, "t1");
        assert_eq!(session.spawn_count, 1);

        // First exit - does NOT increment (already done at spawn)
        session.agent_finished("t2");
        assert_eq!(session.spawn_count, 1);

        // Second spawn (resume) - increments again
        session.agent_spawned(12346, "t3");

        assert_eq!(session.agent_pid, Some(12346));
        assert_eq!(session.claude_session_id, original_session_id);
        assert_eq!(session.spawn_count, 2);

        // Second exit
        session.agent_finished("t4");
        assert_eq!(session.spawn_count, 2);
    }

    #[test]
    fn test_crash_recovery_uses_resume() {
        // Verifies that if an agent crashes (no agent_finished call),
        // the next spawn still sees spawn_count > 0 and uses --resume
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");

        // First spawn
        session.agent_spawned(12345, "t1");
        assert_eq!(session.spawn_count, 1);

        // Simulate crash: just clear PID without calling agent_finished
        session.agent_pid = None;

        // Next spawn should see spawn_count > 0
        assert!(session.spawn_count > 0, "Should use --resume after crash");
    }

    #[test]
    fn test_session_complete() {
        let mut session = StageSession::new("ss-1", "task-1", "planning", "now");
        session.agent_spawned(12345, "t1");

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
        session.claude_session_id = Some("test-uuid".to_string());
        session.spawn_count = 2;

        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("\"id\":\"ss-1\""));
        assert!(json.contains("\"claude_session_id\":\"test-uuid\""));
        assert!(json.contains("\"spawn_count\":2"));

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
        session.claude_session_id = Some("test-uuid".to_string());
        session.session_state = SessionState::Spawning;

        // Spawning sessions should not be resumable (even with session ID)
        assert!(session.claude_session_id.is_some());
        assert!(!session.can_resume()); // Can't resume in Spawning state
        assert!(!session.is_active());
    }
}
