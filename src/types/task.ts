export type TaskStatus =
  | "pending"
  | "in_progress"
  | "ready_for_review"
  | "done"
  | "failed"
  | "blocked";

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
  logs?: string;
  agent_pid?: number;
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-gray-100" },
  in_progress: { label: "In Progress", color: "bg-blue-100" },
  ready_for_review: { label: "Review", color: "bg-yellow-100" },
  done: { label: "Done", color: "bg-green-100" },
  failed: { label: "Failed", color: "bg-red-100" },
  blocked: { label: "Blocked", color: "bg-orange-100" },
};
