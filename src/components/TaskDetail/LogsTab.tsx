/**
 * Logs tab - displays session logs with stage switching via TabbedPanel.
 */

import { useAutoScroll } from "../../hooks/useAutoScroll";
import type { LogEntry, WorkflowTaskView } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { LogList } from "../Logs";
import { FlexContainer, LogTabs, TabbedPanel } from "../ui";

interface LogsTabProps {
  task: WorkflowTaskView;
  logs: LogEntry[];
  isLoading: boolean;
  error: string | null;
  stagesWithLogs: string[];
  activeLogStage: string | null;
  onStageChange: (stage: string) => void;
}

export function LogsTab({
  task,
  logs,
  isLoading,
  error,
  stagesWithLogs,
  activeLogStage,
  onStageChange,
}: LogsTabProps) {
  const { containerRef, handleScroll } = useAutoScroll<HTMLDivElement>([logs], true);

  const tabs = stagesWithLogs.map((stage) => ({
    id: LogTabs.stage(stage),
    label: titleCase(stage),
    indicator:
      stage === task.derived.current_stage && task.derived.is_working ? (
        <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
      ) : undefined,
  }));

  const handleTabChange = (tabId: string) => {
    // Extract raw stage name from animation key
    const raw = stagesWithLogs.find((s) => LogTabs.stage(s) === tabId);
    if (raw && raw !== activeLogStage) {
      onStageChange(raw);
    }
  };

  return (
    <FlexContainer direction="vertical" padded={true}>
      {tabs.length > 0 && activeLogStage && (
        <TabbedPanel
          tabs={tabs}
          activeTab={LogTabs.stage(activeLogStage)}
          onTabChange={handleTabChange}
          size="small"
        >
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="h-full p-4 overflow-auto bg-stone-50 dark:bg-stone-900 text-stone-800 dark:text-stone-200 font-mono text-sm"
          >
            <LogList logs={logs} isLoading={isLoading} error={error} />
          </div>
        </TabbedPanel>
      )}

      {(tabs.length === 0 || !activeLogStage) && (
        <div className="p-4 bg-stone-50 dark:bg-stone-900 text-stone-800 dark:text-stone-200 font-mono text-sm flex-1">
          <LogList logs={logs} isLoading={isLoading} error={error} />
        </div>
      )}
    </FlexContainer>
  );
}
