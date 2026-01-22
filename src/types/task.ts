export type TaskStatus =
  | "planning"
  | "breaking_down"
  | "waiting_on_subtasks"
  | "working"
  | "reviewing"
  | "done"
  | "failed"
  | "blocked";

// Task kind distinguishes between parallel tasks and checklist subtasks
// - task: Appears in Kanban board, has its own worker agent
// - subtask: Hidden from Kanban, shown as checklist item in parent task
export type TaskKind = "task" | "subtask";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export type OrkAction =
  | { action: "set_plan"; task_id: string }
  | { action: "complete"; task_id: string; summary?: string }
  | { action: "fail"; task_id: string; reason?: string }
  | { action: "block"; task_id: string; reason?: string }
  | { action: "approve"; task_id: string }
  | { action: "approve_review"; task_id: string }
  | { action: "reject_review"; task_id: string; feedback?: string }
  | { action: "create_subtask"; parent_id: string; title: string }
  | { action: "set_breakdown"; task_id: string }
  | { action: "approve_breakdown"; task_id: string }
  | { action: "skip_breakdown"; task_id: string }
  | { action: "complete_subtask"; subtask_id: string }
  | { action: "other"; raw: string };

export type ToolInput =
  | { tool: "bash"; command: string }
  | { tool: "read"; file_path: string }
  | { tool: "write"; file_path: string }
  | { tool: "edit"; file_path: string }
  | { tool: "glob"; pattern: string }
  | { tool: "grep"; pattern: string }
  | { tool: "task"; description: string }
  | { tool: "todo_write"; todos: TodoItem[] }
  | { tool: "ork"; ork_action: OrkAction }
  | { tool: "other"; summary: string };

export type LogEntry =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool: string; id: string; input: ToolInput }
  | { type: "tool_result"; tool: string; tool_use_id: string; content: string }
  | {
      type: "subagent_tool_use";
      tool: string;
      id: string;
      input: ToolInput;
      parent_task_id: string;
    }
  | {
      type: "subagent_tool_result";
      tool: string;
      tool_use_id: string;
      content: string;
      parent_task_id: string;
    }
  | { type: "process_exit"; code: number | null }
  | { type: "error"; message: string };

export interface SessionInfo {
  session_id: string;
  started_at: string;
}

// Session type is just the key in the sessions object: "plan", "work", "review_0", etc.
export type SessionType = string;

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  // Kind of task: "task" (Kanban, parallel) or "subtask" (checklist item)
  kind: TaskKind;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  summary?: string;
  error?: string;
  agent_pid?: number;
  plan?: string;
  plan_feedback?: string;
  review_feedback?: string;
  // Feedback from reviewer agent when it rejects work
  reviewer_feedback?: string;
  // Multi-session tracking - logs are loaded on-demand from Claude's session files
  // Keys are session types: "plan", "work", "breakdown", "review_0", "review_1", etc.
  // Object preserves insertion order (creation time)
  sessions?: Record<string, SessionInfo>;
  // Auto-approve mode - when enabled, plans are automatically approved without manual review
  auto_approve?: boolean;
  // Parent task ID for subtasks (undefined for root tasks)
  parent_id?: string;
  // The breakdown produced by the breakdown agent
  breakdown?: string;
  // Feedback for breakdown revision
  breakdown_feedback?: string;
  // Whether this task should skip breakdown and go straight to working
  skip_breakdown?: boolean;
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  planning: { label: "Planning", color: "bg-purple-100" },
  breaking_down: { label: "Breaking Down", color: "bg-indigo-100" },
  waiting_on_subtasks: { label: "Waiting", color: "bg-cyan-100" },
  working: { label: "Working", color: "bg-blue-100" },
  reviewing: { label: "Reviewing", color: "bg-violet-100" },
  done: { label: "Done", color: "bg-green-100" },
  failed: { label: "Failed", color: "bg-red-100" },
  blocked: { label: "Blocked", color: "bg-orange-100" },
};
