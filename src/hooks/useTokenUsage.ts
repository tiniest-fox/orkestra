// Hook for lazily fetching per-task token usage data when the history tab is active.

import { useEffect, useRef, useState } from "react";
import { useTransport } from "../transport";
import type { TaskTokenUsage } from "../types/workflow";
import { isDisconnectError } from "../utils/transportErrors";

interface UseTokenUsageResult {
  tokenUsage: TaskTokenUsage | null;
  loading: boolean;
}

export function useTokenUsage(taskId: string, enabled: boolean): UseTokenUsageResult {
  const transport = useTransport();
  const [tokenUsage, setTokenUsage] = useState<TaskTokenUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const requestedIdsRef = useRef<Set<string>>(new Set());

  // Reset state and the request-dedup ref when the task changes so the previous
  // task's data doesn't flash for the new task, and so switching A→B→A re-fetches A.
  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId is the intentional trigger — the effect body only calls stable setters and mutates a ref, but taskId must be listed so this runs on task switch
  useEffect(() => {
    setTokenUsage(null);
    requestedIdsRef.current.clear();
  }, [taskId]);

  useEffect(() => {
    if (!enabled) return;
    if (requestedIdsRef.current.has(taskId)) return;

    requestedIdsRef.current.add(taskId);
    setLoading(true);

    transport
      .call<TaskTokenUsage>("get_token_usage", { task_id: taskId })
      .then((result) => setTokenUsage(result))
      .catch((err) => {
        requestedIdsRef.current.delete(taskId);
        if (!isDisconnectError(err)) {
          console.error("Failed to fetch token usage:", err);
        }
      })
      .finally(() => setLoading(false));
  }, [taskId, enabled, transport]);

  return { tokenUsage, loading };
}
