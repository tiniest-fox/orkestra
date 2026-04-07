//! Notification service for task state changes.
//!
//! Sends OS notifications when tasks need human attention
//! (review, questions, merge conflicts, errors).

use orkestra_core::orkestra_debug;
use orkestra_networking::{
    format_conflict_notification, format_error_notification, format_review_notification,
};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Sends OS notifications for task state changes.
///
/// Wraps `AppHandle` to provide typed methods for each notification scenario.
/// All methods are best-effort — failures are logged, never propagated.
pub struct TaskNotifier<'a> {
    app: &'a AppHandle,
}

impl<'a> TaskNotifier<'a> {
    pub fn new(app: &'a AppHandle, _window_label: &'a str) -> Self {
        Self { app }
    }

    /// Notify that a stage output is ready for human review.
    pub fn stage_review_needed(
        &self,
        task_id: &str,
        task_title: &str,
        stage: &str,
        output_type: &str,
    ) {
        let (title, body) = format_review_notification(task_title, stage, output_type);
        self.send(task_id, &title, &body);
    }

    /// Notify that a task encountered an error.
    pub fn task_error(&self, task_id: &str, error: &str) {
        let (title, body) = format_error_notification(error);
        self.send(task_id, &title, &body);
    }

    /// Notify that integration (merge) failed with conflicts.
    pub fn merge_conflict(&self, task_id: &str, conflict_count: usize) {
        let (title, body) = format_conflict_notification(task_id, conflict_count);
        self.send(task_id, &title, &body);
    }

    /// Send an OS notification (alert only, no focus event).
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
        } else {
            orkestra_debug!(
                "notification",
                "Sent notification for {}: {}",
                task_id,
                title
            );
        }
    }
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
