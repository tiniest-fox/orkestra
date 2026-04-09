/**
 * Main application content. Single gating point for loading and error states.
 * Both workflow config and tasks load in parallel; renders the Feed only once
 * both have resolved successfully.
 */

import { useRef } from "react";
import { useBrowserNotifications } from "../hooks/useBrowserNotifications";
import { useTasks, useWorkflowConfigState } from "../providers";
import { FeedView } from "./Feed";
import { FeedLoadingSkeleton } from "./Feed/FeedLoadingSkeleton";
import { ErrorState } from "./ui";
import { Button } from "./ui/Button";

export function Orkestra({
  serviceProjectName,
  showHomeLink,
}: {
  serviceProjectName?: string;
  showHomeLink?: boolean;
}) {
  useBrowserNotifications();
  const configState = useWorkflowConfigState();
  const { config, error: configError } = configState;
  const { tasks, loading: tasksLoading } = useTasks();
  const readyLoggedRef = useRef(false);

  if (configError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-canvas">
        <ErrorState message="Failed to load workflow config" error={configError} />
        <Button variant="secondary" size="sm" onClick={configState.retry}>
          Retry
        </Button>
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
