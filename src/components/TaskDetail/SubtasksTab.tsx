/**
 * Subtasks tab - displays child tasks of a parent with progress summary.
 *
 * Fetches subtask data via workflow_list_subtasks Tauri command.
 * Shows each subtask's title, status, and current stage.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { SubtaskProgress, WorkflowTask } from "../../types/workflow";
import { Badge } from "../ui";

interface SubtasksTabProps {
  parentId: string;
  progress: SubtaskProgress;
}

function subtaskStatusBadge(task: WorkflowTask) {
  switch (task.status.type) {
    case "done":
    case "archived":
      return <Badge variant="success">Done</Badge>;
    case "failed":
      return <Badge variant="error">Failed</Badge>;
    case "blocked":
      return <Badge variant="blocked">Blocked</Badge>;
    case "active":
      return <Badge variant="info">{task.status.stage}</Badge>;
    case "waiting_on_children":
      return <Badge variant="neutral">Waiting</Badge>;
    default:
      return <Badge variant="neutral">Unknown</Badge>;
  }
}

function ProgressBar({ progress }: { progress: SubtaskProgress }) {
  const donePercent = (progress.done / progress.total) * 100;
  const failedPercent = (progress.failed / progress.total) * 100;

  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs text-stone-500 dark:text-stone-400 mb-1">
        <span>
          {progress.done}/{progress.total} done
        </span>
        {progress.failed > 0 && (
          <span className="text-error-600 dark:text-error-400">{progress.failed} failed</span>
        )}
      </div>
      <div className="h-1.5 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
        <div className="h-full flex">
          {donePercent > 0 && (
            <div
              className="bg-success-500 dark:bg-success-400 transition-all duration-300"
              style={{ width: `${donePercent}%` }}
            />
          )}
          {failedPercent > 0 && (
            <div
              className="bg-error-500 dark:bg-error-400 transition-all duration-300"
              style={{ width: `${failedPercent}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function SubtasksTab({ parentId, progress }: SubtasksTabProps) {
  const [subtasks, setSubtasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSubtasks = useCallback(async () => {
    try {
      const result = await invoke<WorkflowTask[]>("workflow_list_subtasks", {
        parentId,
      });
      setSubtasks(result);
    } catch (err) {
      console.error("Failed to fetch subtasks:", err);
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => {
    fetchSubtasks();
    const interval = setInterval(fetchSubtasks, 3000);
    return () => clearInterval(interval);
  }, [fetchSubtasks]);

  if (loading) {
    return (
      <div className="p-4 text-stone-500 dark:text-stone-400 text-sm">Loading subtasks...</div>
    );
  }

  return (
    <div className="p-4">
      <ProgressBar progress={progress} />

      {subtasks.length === 0 ? (
        <div className="text-stone-500 dark:text-stone-400 text-sm">No subtasks.</div>
      ) : (
        <div className="space-y-2">
          {subtasks.map((subtask) => (
            <div
              key={subtask.id}
              className="flex items-center justify-between p-2.5 bg-stone-50 dark:bg-stone-800/50 rounded-panel-sm border border-stone-200 dark:border-stone-700"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">
                  {subtask.title}
                </div>
                {subtask.description && (
                  <div className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
                    {subtask.description}
                  </div>
                )}
              </div>
              <div className="ml-3 flex-shrink-0">{subtaskStatusBadge(subtask)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
