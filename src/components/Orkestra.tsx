/**
 * Main application content. Renders the full-screen Feed/Forge view.
 */

import { useNotificationPermission } from "../hooks/useNotificationPermission";
import { useTasks, useWorkflowConfig } from "../providers";
import { FeedView } from "./Feed";

export function Orkestra() {
  useNotificationPermission();
  const { tasks } = useTasks();
  const config = useWorkflowConfig();

  return (
    <div className="forge-theme w-screen h-screen overflow-clip">
      <FeedView config={config} tasks={tasks} />
    </div>
  );
}
