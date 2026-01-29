/**
 * Logs tab - displays session logs with stage switching.
 */

import { useAutoScroll } from "../../hooks/useAutoScroll";
import type { LogEntry, WorkflowTask } from "../../types/workflow";
import { getTaskStage } from "../../types/workflow";
import { LogList } from "../Logs";

interface LogsTabProps {
  task: WorkflowTask;
  logs: LogEntry[];
  isLoading: boolean;
  error: string | null;
  stagesWithLogs: string[];
  activeLogStage: string | null;
  onStageChange: (stage: string) => void;
  onResetAutoScroll: () => void;
}

export function LogsTab({
  task,
  logs,
  isLoading,
  error,
  stagesWithLogs,
  activeLogStage,
  onStageChange,
  onResetAutoScroll,
}: LogsTabProps) {
  const { containerRef, handleScroll } = useAutoScroll<HTMLDivElement>([logs], true);

  const handleStageClick = (stage: string) => {
    if (stage !== activeLogStage) {
      onResetAutoScroll();
      onStageChange(stage);
    }
  };

  return (
    <div className="border-panel -m-4">
      {stagesWithLogs.length > 0 && (
        <div className="flex-shrink-0 flex gap-1 p-2 border-b border-stone-700 bg-stone-800">
          {stagesWithLogs.map((stage) => {
            const currentStage = getTaskStage(task.status);
            const isCurrentStage = stage === currentStage;
            const isActiveTab = activeLogStage === stage;

            return (
              <button
                key={stage}
                type="button"
                onClick={() => handleStageClick(stage)}
                className={`px-3 py-1 text-xs rounded-panel-sm capitalize flex items-center gap-1.5 transition-colors ${
                  isActiveTab ? "bg-sage-600 text-white" : "bg-stone-700 text-stone-300 hover:bg-stone-600"
                }`}
              >
                {stage}
                {isCurrentStage && task.phase === "agent_working" && (
                  <span className="w-1.5 h-1.5 bg-sage-400 rounded-full animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-4 bg-stone-900 font-mono text-sm"
      >
        <LogList logs={logs} isLoading={isLoading} error={error} />
      </div>
    </div>
  );
}
