//! Tauri IPC transport — wraps invoke() and listen() with canonical name mapping.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeUnlisten";
import type { ConnectionState, Transport } from "./types";

// ============================================================================
// Method Mapping
// ============================================================================

/**
 * Maps canonical method names (WebSocket/JSON-RPC style) to Tauri command names.
 *
 * Canonical names come from the orkestra-networking dispatch table. Tauri command
 * names match the #[tauri::command] fn names in src-tauri/src/commands/.
 */
const METHOD_MAP: Record<string, string> = {
  // -- Task CRUD --
  list_tasks: "workflow_get_tasks",
  get_task: "workflow_get_task",
  create_task: "workflow_create_task",
  create_subtask: "workflow_create_subtask",
  delete_task: "workflow_delete_task",
  list_subtasks: "workflow_list_subtasks",
  get_archived_tasks: "workflow_get_archived_tasks",

  // -- Human actions --
  approve: "workflow_approve",
  reject: "workflow_reject",
  answer_questions: "workflow_answer_questions",
  retry: "workflow_retry",
  set_auto_mode: "workflow_set_auto_mode",
  interrupt: "workflow_interrupt",
  resume: "workflow_resume",
  archive: "workflow_archive",
  reject_with_comments: "workflow_reject_with_comments",
  address_pr_feedback: "workflow_address_pr_feedback",
  address_pr_conflicts: "workflow_address_pr_conflicts",
  request_update: "workflow_request_update",
  push_pr_changes: "workflow_push_pr_changes",
  pull_pr_changes: "workflow_pull_pr_changes",
  retry_pr: "workflow_retry_pr",
  merge_task: "workflow_merge_task",
  open_pr: "workflow_open_pr",
  return_to_work: "workflow_return_to_work",

  // -- Startup --
  retry_startup: "workflow_retry_startup",

  // -- Queries --
  get_config: "workflow_get_config",
  get_startup_data: "workflow_get_startup_data",
  get_auto_task_templates: "workflow_get_auto_task_templates",
  get_iterations: "workflow_get_iterations",
  get_artifact: "workflow_get_artifact",
  get_pending_questions: "workflow_get_pending_questions",
  get_current_stage: "workflow_get_current_stage",
  get_rejection_feedback: "workflow_get_rejection_feedback",
  list_branches: "workflow_list_branches",
  get_logs: "workflow_get_logs",
  get_latest_log: "workflow_get_latest_log",
  get_pr_status: "workflow_get_pr_status",

  // -- Diffs --
  get_task_diff: "workflow_get_task_diff",
  get_file_content: "workflow_get_file_content",
  get_syntax_css: "workflow_get_syntax_css",
  get_commit_log: "workflow_get_commit_log",
  get_batch_file_counts: "workflow_get_batch_file_counts",
  get_commit_diff: "workflow_get_commit_diff",

  // -- Git sync --
  git_sync_status: "workflow_git_sync_status",
  git_push: "workflow_git_push",
  git_pull: "workflow_git_pull",
  git_fetch: "workflow_git_fetch",

  // -- Same-name commands (no prefix needed) --
  stage_chat_send: "stage_chat_send",
  stage_chat_stop: "stage_chat_stop",
  assistant_send_message: "assistant_send_message",
  assistant_stop: "assistant_stop",
  assistant_list_sessions: "assistant_list_sessions",
  assistant_get_logs: "assistant_get_logs",
  get_project_info: "get_project_info",
  open_in_terminal: "open_in_terminal",
  open_in_editor: "open_in_editor",
  detect_external_tools: "detect_external_tools",
  start_run_script: "start_run_script",
  stop_run_script: "stop_run_script",
  get_run_status: "get_run_status",
  get_run_logs: "get_run_logs",
};

/**
 * Maps canonical event names (snake_case) to Tauri event names (kebab-case).
 *
 * Tauri emits kebab-case event names from Rust. The canonical layer uses
 * snake_case to match the WebSocket server's event naming convention.
 */
const EVENT_MAP: Record<string, string> = {
  task_updated: "task-updated",
  review_ready: "review-ready",
  startup_data: "startup-data",
  startup_error: "startup-error",
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Convert snake_case param keys to camelCase for Tauri invoke().
 *
 * Tauri's #[tauri::command] macro deserializes camelCase param names from JS.
 * Canonical params use snake_case (e.g. task_id → taskId, base_branch → baseBranch).
 */
function toTauriParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camel] = value;
  }
  return result;
}

/**
 * Transport implementation backed by Tauri IPC (invoke + listen).
 *
 * Always reports as connected — Tauri IPC is synchronous with the backend
 * and never needs reconnection logic.
 */
export class TauriTransport implements Transport {
  readonly supportsLocalOperations = true;
  readonly requiresAuthentication = false;
  readonly connectionState: ConnectionState = "connected";

  call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const tauriCommand = METHOD_MAP[method] ?? method;
    const tauriParams = params ? toTauriParams(params) : {};
    return invoke<T>(tauriCommand, tauriParams);
  }

  on<T = unknown>(event: string, handler: (data: T) => void): () => void {
    const tauriEvent = EVENT_MAP[event] ?? event.replace(/_/g, "-");
    const promise = listen<T>(tauriEvent, ({ payload }) => {
      handler(payload);
    });
    return () => {
      safeUnlisten(promise);
    };
  }

  onConnectionStateChange(_handler: (state: ConnectionState) => void): () => void {
    // Connection state never changes for Tauri — no-op subscription.
    return () => {};
  }
}
