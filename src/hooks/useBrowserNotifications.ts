// Browser notification hook for PWA mode. Fires Web Notifications for
// review-ready, error, and merge-conflict events when the tab is backgrounded.
// Tauri handles its own notifications via TaskNotifier — this hook skips
// in Tauri builds (enforced by TAURI_ENV_PLATFORM build-time guard).

import { useTransportListener } from "../transport/useTransportListener";
import type { MergeConflictPayload, ReviewReadyPayload, TaskErrorPayload } from "../types/events";

export function useBrowserNotifications(): void {
  // Build-time guard: Tauri handles its own notifications via TaskNotifier.
  // This MUST use import.meta.env.TAURI_ENV_PLATFORM (build-time), not a
  // runtime check, to prevent duplicate notifications.
  const isTauri = !!import.meta.env.TAURI_ENV_PLATFORM;

  useTransportListener<ReviewReadyPayload>("review_ready", (data) => {
    if (isTauri) return;
    if (!document.hidden) return;
    showNotification(data.notification_title, data.notification_body);
  });

  useTransportListener<TaskErrorPayload>("task_error", (data) => {
    if (isTauri) return;
    if (!document.hidden) return;
    showNotification(data.notification_title, data.notification_body);
  });

  useTransportListener<MergeConflictPayload>("merge_conflict", (data) => {
    if (isTauri) return;
    if (!document.hidden) return;
    showNotification(data.notification_title, data.notification_body);
  });
}

function showNotification(title: string, body: string): void {
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch (err) {
    console.warn("[notifications] Failed to show notification:", err);
  }
}
