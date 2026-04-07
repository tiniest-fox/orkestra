// WebSocket event payload types. These mirror the JSON shapes from
// Event::review_ready(), Event::task_error(), and Event::merge_conflict()
// in orkestra-networking/src/types.rs.

export interface ReviewReadyPayload {
  task_id: string;
  parent_id: string | null;
  task_title: string;
  stage: string;
  output_type: string;
  notification_title: string;
  notification_body: string;
}

export interface TaskErrorPayload {
  task_id: string;
  error: string;
  notification_title: string;
  notification_body: string;
}

export interface MergeConflictPayload {
  task_id: string;
  conflict_count: number;
  notification_title: string;
  notification_body: string;
}
