export type TaskStatus =
  | "planning"
  | "working"
  | "done"
  | "failed"
  | "blocked";

export type ToolInput =
  | { tool: "bash"; command: string }
  | { tool: "read"; file_path: string }
  | { tool: "write"; file_path: string }
  | { tool: "edit"; file_path: string }
  | { tool: "glob"; pattern: string }
  | { tool: "grep"; pattern: string }
  | { tool: "task"; description: string }
  | { tool: "other"; summary: string };

export type LogEntry =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool: string; id: string; input: ToolInput }
  | { type: "tool_result"; tool: string; tool_use_id: string; content: string }
  | { type: "subagent_tool_use"; tool: string; id: string; input: ToolInput; parent_task_id: string }
  | { type: "subagent_tool_result"; tool: string; tool_use_id: string; content: string; parent_task_id: string }
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
  created_at: string;
  updated_at: string;
  completed_at?: string;
  summary?: string;
  error?: string;
  agent_pid?: number;
  plan?: string;
  plan_feedback?: string;
  review_feedback?: string;
  // Multi-session tracking - logs are loaded on-demand from Claude's session files
  // Keys are session types: "plan", "work", "review_0", "review_1", etc.
  // Object preserves insertion order (creation time)
  sessions?: Record<string, SessionInfo>;
  // Auto-approve mode - when enabled, plans are automatically approved without manual review
  auto_approve?: boolean;
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  planning: { label: "Planning", color: "bg-purple-100" },
  working: { label: "Working", color: "bg-blue-100" },
  done: { label: "Done", color: "bg-green-100" },
  failed: { label: "Failed", color: "bg-red-100" },
  blocked: { label: "Blocked", color: "bg-orange-100" },
};
