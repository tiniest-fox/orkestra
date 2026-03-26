//! Assistant session tracking for project-level and task-scoped chat.
//!
//! An `AssistantSession` tracks a Claude Code session for the assistant chat panel.
//! Sessions can be project-level (`task_id` = None) or task-scoped (`task_id` = Some).

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// Reuse `SessionState` from `stage_session`.
pub use super::stage_session::SessionState;

/// Distinguishes assistant (read-only chat) from interactive (edit-capable) sessions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionType {
    /// Read-only assistant chat session.
    #[default]
    Assistant,
    /// Interactive session where the user directs file editing work.
    Interactive,
}

impl fmt::Display for SessionType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Assistant => write!(f, "assistant"),
            Self::Interactive => write!(f, "interactive"),
        }
    }
}

impl FromStr for SessionType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "assistant" => Ok(Self::Assistant),
            "interactive" => Ok(Self::Interactive),
            other => Err(format!("Unknown session type: {other}")),
        }
    }
}

/// An assistant session for project-level or task-scoped chat.
///
/// Sessions with `task_id = None` are project-level. Sessions with `task_id = Some`
/// are scoped to a specific task (at most one per task, enforced by a DB UNIQUE index).
/// Both maintain Claude session continuity across app restarts and process crashes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AssistantSession {
    /// Unique identifier for this session.
    pub id: String,

    /// Claude session ID. Generated upfront at session creation so log polling can find
    /// the JSONL file immediately. Used with --session-id on first spawn, --resume on subsequent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,

    /// Optional user-provided title for the session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

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

    /// Task this session is scoped to, or `None` for project-level sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,

    /// Whether this is an assistant (read-only) or interactive (edit-capable) session.
    #[serde(default)]
    pub session_type: SessionType,
}

impl AssistantSession {
    /// Create a new assistant session.
    ///
    /// The `claude_session_id` starts as `None`. For providers that accept caller-supplied
    /// session IDs (Claude Code), the caller sets it before spawn. For providers that
    /// generate their own IDs (`OpenCode`), it stays `None` until extracted from the output stream.
    pub fn new(id: impl Into<String>, created_at: impl Into<String>) -> Self {
        let created = created_at.into();
        Self {
            id: id.into(),
            claude_session_id: None,
            title: None,
            agent_pid: None,
            spawn_count: 0,
            session_state: SessionState::Active,
            created_at: created.clone(),
            updated_at: created,
            task_id: None,
            session_type: SessionType::Assistant,
        }
    }

    /// Mark this session as interactive type.
    #[must_use]
    pub fn with_interactive_type(mut self) -> Self {
        self.session_type = SessionType::Interactive;
        self
    }

    /// Scope this session to a specific task.
    #[must_use]
    pub fn with_task(mut self, task_id: impl Into<String>) -> Self {
        self.task_id = Some(task_id.into());
        self
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

    /// Set the session title.
    pub fn set_title(&mut self, title: impl Into<String>, updated_at: impl Into<String>) {
        self.title = Some(title.into());
        self.updated_at = updated_at.into();
    }

    /// Mark the session as completed.
    pub fn complete(&mut self, updated_at: impl Into<String>) {
        self.session_state = SessionState::Completed;
        self.agent_pid = None;
        self.updated_at = updated_at.into();
    }

    /// Mark the session as abandoned (e.g., user closed it).
    pub fn abandon(&mut self, updated_at: impl Into<String>) {
        self.session_state = SessionState::Abandoned;
        self.agent_pid = None;
        self.updated_at = updated_at.into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_assistant_session_new() {
        let session = AssistantSession::new("as-1", "2025-01-24T10:00:00Z");

        assert_eq!(session.id, "as-1");
        assert!(session.claude_session_id.is_none());
        assert!(session.title.is_none());
        assert!(session.agent_pid.is_none());
        assert_eq!(session.spawn_count, 0);
        assert!(session.is_active());
        assert!(!session.can_resume()); // Can't resume without session ID
    }

    #[test]
    fn test_agent_spawned() {
        let mut session = AssistantSession::new("as-1", "now");
        session.claude_session_id = Some("test-uuid".to_string());

        session.agent_spawned(12345, "later");

        assert_eq!(session.agent_pid, Some(12345));
        assert_eq!(session.spawn_count, 1);
        assert!(session.has_agent());
        assert!(session.can_resume());
    }

    #[test]
    fn test_agent_finished() {
        let mut session = AssistantSession::new("as-1", "now");
        session.agent_spawned(12345, "t1");

        session.agent_finished("t2");

        assert!(session.agent_pid.is_none());
        assert_eq!(session.spawn_count, 1); // Not incremented on finish
        assert!(!session.has_agent());
    }

    #[test]
    fn test_set_title() {
        let mut session = AssistantSession::new("as-1", "now");

        session.set_title("My Chat Session", "later");

        assert_eq!(session.title, Some("My Chat Session".to_string()));
    }

    #[test]
    fn test_complete() {
        let mut session = AssistantSession::new("as-1", "now");
        session.agent_spawned(12345, "t1");

        session.complete("t2");

        assert_eq!(session.session_state, SessionState::Completed);
        assert!(session.agent_pid.is_none());
        assert!(!session.is_active());
        assert!(!session.can_resume());
    }

    #[test]
    fn test_abandon() {
        let mut session = AssistantSession::new("as-1", "now");

        session.abandon("later");

        assert_eq!(session.session_state, SessionState::Abandoned);
        assert!(!session.is_active());
    }

    #[test]
    fn test_serialization() {
        let mut session = AssistantSession::new("as-1", "2025-01-24T10:00:00Z");
        session.claude_session_id = Some("test-uuid".to_string());
        session.title = Some("My Session".to_string());
        session.spawn_count = 2;

        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("\"id\":\"as-1\""));
        assert!(json.contains("\"claude_session_id\":\"test-uuid\""));
        assert!(json.contains("\"title\":\"My Session\""));
        assert!(json.contains("\"spawn_count\":2"));
        // task_id is None so it should be omitted (skip_serializing_if)
        assert!(!json.contains("task_id"));

        let parsed: AssistantSession = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, session);
    }

    #[test]
    fn test_with_task_builder() {
        let session = AssistantSession::new("as-2", "2025-01-24T10:00:00Z").with_task("task-abc");

        assert_eq!(session.task_id, Some("task-abc".to_string()));
    }

    #[test]
    fn test_with_task_serialization_roundtrip() {
        let session = AssistantSession::new("as-3", "2025-01-24T10:00:00Z").with_task("task-xyz");

        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("\"task_id\":\"task-xyz\""));

        let parsed: AssistantSession = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.task_id, Some("task-xyz".to_string()));
        assert_eq!(parsed, session);
    }

    #[test]
    fn test_crash_recovery() {
        let mut session = AssistantSession::new("as-1", "now");
        session.claude_session_id = Some("test-uuid".to_string());

        // First spawn
        session.agent_spawned(12345, "t1");
        assert_eq!(session.spawn_count, 1);

        // Simulate crash (clear PID without calling agent_finished)
        session.agent_pid = None;

        // Next spawn should see spawn_count > 0 and use --resume
        assert!(session.spawn_count > 0);
    }
}
