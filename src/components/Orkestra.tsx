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

export function Orkestra({
  serviceProjectName,
  showHomeLink,
}: {
  serviceProjectName?: string;
  showHomeLink?: boolean;
}) {
  useNotificationPermission();
  const configState = useWorkflowConfigState();
  const { config, error: configError } = configState;
  const { tasks, loading: tasksLoading } = useTasks();
  const readyLoggedRef = useRef(false);

  if (configError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-canvas">
        <ErrorState message="Failed to load workflow config" error={configError} />
        <button
          type="button"
          onClick={configState.retry}
          className="px-4 py-2 text-sm rounded-panel-sm bg-surface-2 text-text-secondary hover:bg-surface-3 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!config || (tasksLoading && tasks.length === 0)) {
    return <FeedLoadingSkeleton statusText="Loading Orkestra…" />;
  }

  if (!readyLoggedRef.current) {
    readyLoggedRef.current = true;
    console.timeEnd("[startup] ready");
  }

  return (
    <div className="w-full h-full overflow-clip bg-canvas">
      <FeedView
        config={config}
        tasks={tasks}
        serviceProjectName={serviceProjectName}
        showHomeLink={showHomeLink}
      />
    </div>
  );
}
