//! Notification service for task state changes.
//!
//! Sends OS notifications and window-targeted frontend events when tasks need
//! human attention (review, questions, merge conflicts, errors).

use orkestra_core::orkestra_debug;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// Sends OS notifications and window-targeted frontend events for task state changes.
///
/// Wraps `AppHandle` to provide typed methods for each notification scenario.
/// All methods are best-effort — failures are logged, never propagated.
pub struct TaskNotifier<'a> {
    app: &'a AppHandle,
    window_label: &'a str,
}

impl<'a> TaskNotifier<'a> {
    pub fn new(app: &'a AppHandle, window_label: &'a str) -> Self {
        Self { app, window_label }
    }

    /// Notify that a stage output is ready for human review.
    pub fn stage_review_needed(
        &self,
        task_id: &str,
        task_title: &str,
        stage: &str,
        output_type: &str,
    ) {
        let (title, body) = match output_type {
            "questions" => (
                "Questions need answers".to_string(),
                format!("{task_title} — {stage} agent has questions"),
            ),
            "subtasks" => (
                "Subtasks need approval".to_string(),
                format!("{task_title} — review proposed subtask breakdown"),
            ),
            "approval" => (
                "Rejection needs review".to_string(),
                format!("{task_title} — reviewer rejected, needs your decision"),
            ),
            _ => (
                "Ready for review".to_string(),
                format!("{task_title} — {stage} stage output ready"),
            ),
        };

        self.send(task_id, &title, &body);
    }

    /// Notify that a task encountered an error.
    pub fn task_error(&self, task_id: &str, error: &str) {
        let body = truncate_at_char_boundary(error, 200);
        self.send(task_id, "Task error", body);
    }

    /// Notify that integration (merge) failed with conflicts.
    pub fn merge_conflict(&self, task_id: &str, conflict_count: usize) {
        let body = format!("{task_id} — {conflict_count} conflicting files");
        self.send(task_id, "Merge conflict", &body);
    }

    /// Send an OS notification and emit a window-targeted "focus-task" event.
    fn send(&self, task_id: &str, title: &str, body: &str) {
        // OS notification (app-wide, just an alert)
        if let Err(e) = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
        {
            orkestra_debug!("notification", "Failed to send: {e}");
        }

        // Window-targeted event so only the correct project frontend reacts
        let _ = self.app.emit_to(self.window_label, "focus-task", task_id);
    }
}

/// Truncate a string to at most `max_bytes` bytes, landing on a valid UTF-8
/// char boundary. Returns the full string if it's already within the limit.
fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Request notification permission from the OS on startup.
///
/// On macOS desktop, the Tauri plugin always returns "Granted" — actual permission
/// is controlled in System Settings. In dev mode, notifications route through
/// Terminal's notification identity.
pub fn request_permission(app_handle: &AppHandle) {
    let notification = app_handle.notification();

    match notification.permission_state() {
        Ok(tauri::plugin::PermissionState::Granted) => {
            orkestra_debug!("notification", "Notification permission: granted");
        }
        Ok(state) => {
            orkestra_debug!(
                "notification",
                "Notification permission state: {state:?}, requesting permission"
            );
            match notification.request_permission() {
                Ok(tauri::plugin::PermissionState::Granted) => {
                    orkestra_debug!("notification", "Notification permission granted");
                }
                Ok(state) => {
                    orkestra_debug!(
                        "notification",
                        "Notification permission not granted: {state:?}. \
                         Enable notifications in System Settings to receive task alerts."
                    );
                }
                Err(e) => {
                    orkestra_debug!(
                        "notification",
                        "Failed to request notification permission: {e}"
                    );
                }
            }
        }
        Err(e) => {
            orkestra_debug!(
                "notification",
                "Failed to check notification permission: {e}"
            );
        }
    }

    if tauri::is_dev() {
        orkestra_debug!(
            "notification",
            "Dev mode: notifications appear under Terminal in System Settings. \
             Ensure Terminal notifications are enabled in System Settings > Notifications."
        );
    }
}
