// Browser notification hook for PWA mode. Fires Web Notifications for
// review-ready, error, and merge-conflict events when the tab is backgrounded.
// Tauri handles its own notifications via TaskNotifier — this hook skips
// in Tauri builds (enforced by TAURI_ENV_PLATFORM build-time guard).

import { useTransportListener } from "../transport/useTransportListener";

interface ReviewReadyPayload {
  task_id: string;
  parent_id: string | null;
  task_title: string;
  stage: string;
  output_type: string;
}

interface TaskErrorPayload {
  task_id: string;
  error: string;
}

interface MergeConflictPayload {
  task_id: string;
  conflict_count: number;
}

export function useBrowserNotifications(): void {
  // Build-time guard: Tauri handles its own notifications via TaskNotifier.
  // This MUST use import.meta.env.TAURI_ENV_PLATFORM (build-time), not a
  // runtime check, to prevent duplicate notifications.
  const isTauri = !!import.meta.env.TAURI_ENV_PLATFORM;

  useTransportListener<ReviewReadyPayload>("review_ready", (data) => {
    if (isTauri) return;
    if (!document.hidden) return;
    const { task_title, stage, output_type } = data;
    // Match title/body format from src-tauri/src/notifications.rs TaskNotifier
    let title: string;
    let body: string;
    switch (output_type) {
      case "questions":
        title = "Questions need answers";
        body = `${task_title} — ${stage} agent has questions`;
        break;
      case "subtasks":
        title = "Subtasks need approval";
        body = `${task_title} — review proposed subtask breakdown`;
        break;
      case "approval":
        title = "Rejection needs review";
        body = `${task_title} — reviewer rejected, needs your decision`;
        break;
      default:
        title = "Ready for review";
        body = `${task_title} — ${stage} stage output ready`;
    }
    showNotification(title, body);
  });

  useTransportListener<TaskErrorPayload>("task_error", (data) => {
    if (isTauri) return;
    if (!document.hidden) return;
    // Truncate error to 200 chars (matching Rust's truncate_at_char_boundary)
    const body = data.error.length > 200 ? data.error.slice(0, 200) : data.error;
    showNotification("Task error", body);
  });

  useTransportListener<MergeConflictPayload>("merge_conflict", (data) => {
    if (isTauri) return;
    if (!document.hidden) return;
    showNotification(
      "Merge conflict",
      `${data.task_id} — ${data.conflict_count} conflicting files`,
    );
  });
}

function showNotification(title: string, body: string): void {
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Silently ignore — permission may have been revoked or API unavailable
  }
}
