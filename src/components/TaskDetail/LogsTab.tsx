/**
 * Logs tab - displays session logs with stage switching via TabbedPanel.
 */

import { useAutoScroll } from "../../hooks/useAutoScroll";
import type { LogEntry, WorkflowTask } from "../../types/workflow";
import { getTaskStage } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { TabbedPanel } from "../ui";
import { LogList } from "../Logs";
import { Panel, PanelContainer } from "../ui";

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

  const currentStage = getTaskStage(task.status);

  const tabs = stagesWithLogs.map((stage) => ({
    id: stage,
    label: titleCase(stage),
    indicator:
      stage === currentStage && task.phase === "agent_working" ? (
        <span className="w-1.5 h-1.5 bg-sage-400 rounded-full animate-pulse" />
      ) : undefined,
  }));

  const handleTabChange = (tabId: string) => {
    if (tabId !== activeLogStage) {
      onStageChange(tabId);
    }
  };

  return (
    <PanelContainer direction="vertical" padded={true}>
      {tabs.length > 0 && activeLogStage && (
        <TabbedPanel tabs={tabs} activeTab={activeLogStage} onTabChange={handleTabChange}>
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="h-full p-4 overflow-auto bg-stone-900 font-mono text-sm"
          >
            <LogList logs={logs} isLoading={isLoading} error={error} />
          </div>
        </TabbedPanel>
      )}

      {(tabs.length === 0 || !activeLogStage) && (
        <div className="p-4 bg-stone-900 font-mono text-sm flex-1">
          <LogList logs={logs} isLoading={isLoading} error={error} />
        </div>
      )}
    </PanelContainer>
  );
}
