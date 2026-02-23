/**
 * Main application content. Single gating point for loading and error states.
 * Both workflow config and tasks load in parallel; renders the Feed only once
 * both have resolved successfully.
 */

import { useRef } from "react";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import { useTasks, useWorkflowConfigState } from "../providers";
import { FeedView } from "./Feed";
import { FeedLoadingSkeleton } from "./Feed/FeedLoadingSkeleton";
import { ErrorState } from "./ui";

export function Orkestra() {
  useNotificationPermission();
  const { config, error: configError } = useWorkflowConfigState();
  const { tasks, loading: tasksLoading } = useTasks();
  const readyLoggedRef = useRef(false);

  if (configError) {
    return (
      <div className="forge-theme w-screen h-screen flex items-center justify-center bg-[var(--canvas)]">
        <ErrorState message="Failed to load workflow config" error={configError} />
      </div>
    );
  }

  if (!config || (tasksLoading && tasks.length === 0)) {
    return <FeedLoadingSkeleton />;
  }

  if (!readyLoggedRef.current) {
    readyLoggedRef.current = true;
    console.timeEnd("[startup] ready");
  }

  return (
    <div className="forge-theme w-screen h-screen overflow-clip">
      <FeedView config={config} tasks={tasks} />
    </div>
  );
}
