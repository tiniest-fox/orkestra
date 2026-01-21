export type TaskStatus =
  | "pending"
  | "planning"
  | "awaiting_approval"
  | "in_progress"
  | "ready_for_review"
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
  | { type: "process_exit"; code: number | null }
  | { type: "error"; message: string };

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
  logs?: LogEntry[];
  agent_pid?: number;
  plan?: string;
  plan_feedback?: string;
  review_feedback?: string;
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-gray-100" },
  planning: { label: "Planning", color: "bg-purple-100" },
  awaiting_approval: { label: "Awaiting Approval", color: "bg-amber-100" },
  in_progress: { label: "In Progress", color: "bg-blue-100" },
  ready_for_review: { label: "Review", color: "bg-yellow-100" },
  done: { label: "Done", color: "bg-green-100" },
  failed: { label: "Failed", color: "bg-red-100" },
  blocked: { label: "Blocked", color: "bg-orange-100" },
};
