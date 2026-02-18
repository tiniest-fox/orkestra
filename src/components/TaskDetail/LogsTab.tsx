/**
 * Logs tab - displays session logs with stage switching via TabbedPanel.
 * Renders nested sub-tabs when a stage has multiple sessions.
 */

import { useEffect } from "react";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import type { LogEntry, StageLogInfo, WorkflowTaskView } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { LogList } from "../Logs";
import { FlexContainer, LogTabs, TabbedPanel } from "../ui";

interface LogsTabProps {
  task: WorkflowTaskView;
  logs: LogEntry[];
  isLoading: boolean;
  error: unknown;
  stagesWithLogs: StageLogInfo[];
  activeLogStage: string | null;
  activeSessionId: string | null;
  onStageChange: (stage: string) => void;
  onSessionChange: (sessionId: string | null) => void;
}

export function LogsTab({
  task,
  logs,
  isLoading,
  error,
  stagesWithLogs,
  activeLogStage,
  activeSessionId,
  onStageChange,
  onSessionChange,
}: LogsTabProps) {
  const { containerRef, handleScroll, resetAutoScroll } = useAutoScroll<HTMLDivElement>(true);

  // Reset auto-scroll when stage or session changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetAutoScroll is stable, activeLogStage and activeSessionId are triggers
  useEffect(() => {
    resetAutoScroll();
  }, [activeLogStage, activeSessionId]);

  // Build outer tabs from stage data
  const tabs = stagesWithLogs.map((stageInfo) => ({
    id: LogTabs.stage(stageInfo.stage),
    label: titleCase(stageInfo.stage),
    indicator:
      stageInfo.stage === task.derived.current_stage && task.derived.is_working ? (
        <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
      ) : undefined,
  }));

  const handleTabChange = (tabId: string) => {
    const stageInfo = stagesWithLogs.find((s) => LogTabs.stage(s.stage) === tabId);
    if (stageInfo && stageInfo.stage !== activeLogStage) {
      onStageChange(stageInfo.stage);
    }
  };

  // Find the active stage's session info
  const activeStageInfo = stagesWithLogs.find((s) => s.stage === activeLogStage);
  const hasMultipleSessions = activeStageInfo && activeStageInfo.sessions.length > 1;

  // Build sub-tabs for multi-session stages
  const sessionTabs = hasMultipleSessions
    ? activeStageInfo.sessions.map((session) => ({
        id: session.session_id,
        label: `Run #${session.run_number}`,
        indicator:
          session.is_current &&
          activeStageInfo.stage === task.derived.current_stage &&
          task.derived.is_working ? (
            <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
          ) : undefined,
      }))
    : [];

  const handleSessionChange = (sessionId: string) => {
    if (sessionId !== activeSessionId) {
      onSessionChange(sessionId);
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
          {hasMultipleSessions && activeSessionId ? (
            <TabbedPanel
              tabs={sessionTabs}
              activeTab={activeSessionId}
              onTabChange={handleSessionChange}
              size="small"
            >
              <LogContent
                containerRef={containerRef}
                handleScroll={handleScroll}
                logs={logs}
                isLoading={isLoading}
                error={error}
              />
            </TabbedPanel>
          ) : (
            <LogContent
              containerRef={containerRef}
              handleScroll={handleScroll}
              logs={logs}
              isLoading={isLoading}
              error={error}
            />
          )}
        </TabbedPanel>
      )}

      {(tabs.length === 0 || !activeLogStage) && (
        <LogContent
          containerRef={containerRef}
          handleScroll={handleScroll}
          logs={logs}
          isLoading={isLoading}
          error={error}
          className="flex-1"
        />
      )}
    </FlexContainer>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Log content container with scroll handling.
 */
function LogContent({
  containerRef,
  handleScroll,
  logs,
  isLoading,
  error,
  className = "",
}: {
  containerRef: (node: HTMLDivElement | null) => void;
  handleScroll: () => void;
  logs: LogEntry[];
  isLoading: boolean;
  error: unknown;
  className?: string;
}) {
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`h-full p-4 overflow-auto bg-stone-50 dark:bg-stone-900 text-stone-800 dark:text-stone-200 font-mono text-sm ${className}`}
    >
      <LogList logs={logs} isLoading={isLoading} error={error} />
    </div>
  );
}
