//! Clear stale `chat_active` flags left over from app crashes.

use crate::orkestra_debug;
use crate::workflow::ports::WorkflowStore;

/// Clear `chat_active` on all sessions at startup.
///
/// If the app crashes while chat mode is active, the flag stays set in the
/// database. On restart, chat mode is meaningless without an active process,
/// so we clear all flags unconditionally.
pub fn execute(store: &dyn WorkflowStore) {
    let Ok(sessions) = store.list_all_stage_sessions() else {
        orkestra_debug!(
            "recovery",
            "Failed to list stage sessions for chat recovery"
        );
        return;
    };

    for mut session in sessions {
        if session.chat_active {
            orkestra_debug!(
                "recovery",
                "Clearing stale chat_active on session {} (task={}, stage={})",
                session.id,
                session.task_id,
                session.stage
            );
            let now = chrono::Utc::now().to_rfc3339();
            session.exit_chat(&now);
            if let Err(e) = store.save_stage_session(&session) {
                orkestra_debug!(
                    "recovery",
                    "Failed to clear chat_active on session {}: {}",
                    session.id,
                    e
                );
            }
        }
    }
}
