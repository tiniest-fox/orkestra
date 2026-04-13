//! Unified task drawer — adapts to task state (questions, review, working, done, waiting on children).
//! Replaces FocusDrawer, ReviewDrawer, AnswerDrawer, ShipDrawer, and ChildrenDrawer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoScroll } from "../../../hooks/useAutoScroll";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { useLogs } from "../../../hooks/useLogs";
import { useProjectInfo } from "../../../hooks/useProjectInfo";
import { useRunScript } from "../../../hooks/useRunScript";
import { ProjectInfoProvider, useWorkflowConfig } from "../../../providers";
import { useTransport } from "../../../transport";
import type { WorkflowTaskView } from "../../../types/workflow";
import { groupIterationsIntoRuns } from "../../../utils/stageRuns";
import { Drawer } from "../../ui/Drawer/Drawer";
import { HotkeyScope } from "../../ui/HotkeyScope";
import { DrawerHeader, drawerAccent } from "../DrawerHeader";
import { DrawerTabBar } from "../DrawerTabBar";
import { DrawerTaskProvider } from "../DrawerTaskProvider";
import { HistoricalRunView } from "../HistoricalRunView";
import { DrawerTabContent } from "./DrawerTabContent";
import type { DrawerTabId } from "./drawerTabs";
import {
  availableTabs,
  canUseRunScript,
  currentArtifact,
  defaultTab,
  stageReviewType,
} from "./drawerTabs";
import { DrawerFooter } from "./Footer/DrawerFooter";
import { useDrawerHotkeys } from "./useDrawerHotkeys";
import { useTaskDrawerState } from "./useTaskDrawerState";

// ============================================================================
// TaskDrawerBody (internal)
// ============================================================================

interface TaskDrawerBodyProps {
  task: WorkflowTaskView;
  allTasks: WorkflowTaskView[];
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onRejectModeChange?: (active: boolean) => void;
  onOpenChat?: () => void;
  onInteractive?: () => void;
}

function TaskDrawerBody({
  task,
  allTasks,
  onClose,
  onOpenTask,
  onRejectModeChange,
  onOpenChat,
  onInteractive,
}: TaskDrawerBodyProps) {
  const transport = useTransport();
  const config = useWorkflowConfig();
  const accent = drawerAccent(task, config);
  const projectInfo = useProjectInfo();

  // -- Tab state --
  // Run script is Tauri-only — never show the tab or button in PWA context.
  const hasRunScript = transport.supportsLocalOperations ? projectInfo?.has_run_script : false;
  const tabs = availableTabs(task, config, { hasRunScript });
  const [activeTab, setActiveTab] = useState<DrawerTabId>(() => defaultTab(task));

  // -- Run script (single instance, shared with header and tab) --
  const showRunButton = canUseRunScript(task, hasRunScript);
  const runScript = useRunScript(task.id, showRunButton || activeTab === "run");

  // Reset tab when task state type or id changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task state type change
  useEffect(() => {
    setActiveTab(defaultTab(task));
  }, [task.id, task.state.type, task.derived.is_chatting]);

  // -- Run history --
  const [selectedRunIdx, setSelectedRunIdx] = useState<number | null>(null);
  const runs = useMemo(
    () => groupIterationsIntoRuns(task.iterations, config),
    [task.iterations, config],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setSelectedRunIdx(null);
  }, [task.id]);

  // -- Action state from hook --
  const state = useTaskDrawerState(task, onClose);
  const { rejectMode } = state;

  useEffect(() => {
    onRejectModeChange?.(rejectMode);
  }, [rejectMode, onRejectModeChange]);

  // -- Logs (logs tab) --
  const showLogs = (activeTab === "logs" || activeTab === "agent") && selectedRunIdx === null;
  const isChatting = task.derived.is_chatting;
  const { logs, error: logsError } = useLogs(task, showLogs, undefined, isChatting);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const { containerRef: logAutoScrollRef, handleScroll: handleLogScroll } =
    useAutoScroll<HTMLDivElement>(showLogs);
  const logContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      (logScrollRef as { current: HTMLDivElement | null }).current = node;
      logAutoScrollRef(node);
    },
    [logAutoScrollRef],
  );

  // -- Scroll ref for non-log tabs --
  const bodyRef = useRef<HTMLDivElement>(null);
  const activeScrollRef = showLogs ? logScrollRef : bodyRef;

  // -- Hotkeys --
  useDrawerHotkeys({
    task,
    activeTab,
    setActiveTab,
    activeScrollRef,
    selectedRunIdx,
    setSelectedRunIdx,
    runs,
    onArchive: state.handleArchive,
  });

  // -- Derived --
  const artifact = currentArtifact(task, config);
  const selectedRun = selectedRunIdx !== null ? runs[selectedRunIdx] : null;
  const reviewType = stageReviewType(task, config);

  const onProgressClick =
    selectedRunIdx !== null
      ? () => {
          setSelectedRunIdx(null);
          setActiveTab("subtasks");
        }
      : undefined;
  const onWaitingChipClick = () => {
    setSelectedRunIdx(null);
    setActiveTab("subtasks");
  };

  return (
    <div className="flex flex-col h-full">
      <DrawerHeader
        task={task}
        config={config}
        onClose={onClose}
        accent={accent}
        escHidden={rejectMode}
        selectedRunIdx={selectedRunIdx}
        onSelectRun={setSelectedRunIdx}
        onProgressClick={onProgressClick}
        onWaitingChipClick={task.derived.is_waiting_on_children ? onWaitingChipClick : undefined}
        isWaitingChipSelected={
          task.derived.is_waiting_on_children ? selectedRunIdx === null : undefined
        }
        onToggleAutoMode={state.handleToggleAutoMode}
        autoModeOverride={state.optimisticAutoMode ?? undefined}
        showRunButton={showRunButton}
        runStatus={runScript.status}
        runLoading={runScript.loading}
        onRunStart={runScript.start}
        onRunStop={runScript.stop}
        onOpenChat={onOpenChat}
        onInteractive={onInteractive}
      />

      {selectedRun ? (
        <HistoricalRunView task={task} run={selectedRun} accent={accent} />
      ) : (
        <>
          <DrawerTabBar
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as DrawerTabId)}
            accent={accent}
          />

          {/* Body */}
          <DrawerTabContent
            task={task}
            allTasks={allTasks}
            activeTab={activeTab}
            artifact={artifact}
            config={config}
            logs={logs}
            logsError={logsError}
            logContainerRef={logContainerRef}
            handleLogScroll={handleLogScroll}
            bodyRef={bodyRef}
            state={state}
            onOpenTask={onOpenTask}
            runScript={runScript}
          />

          {/* Footer */}
          <DrawerFooter
            task={task}
            activeTab={activeTab}
            stageReviewType={reviewType}
            state={state}
          />
        </>
      )}
    </div>
  );
}

// ============================================================================
// TaskDrawer (public export)
// ============================================================================

export interface TaskDrawerProps {
  task: WorkflowTaskView | null;
  allTasks: WorkflowTaskView[];
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onRejectModeChange?: (active: boolean) => void;
  onOpenChat?: () => void;
  onInteractive?: () => void;
}

export function TaskDrawer({
  task,
  allTasks,
  onClose,
  onOpenTask,
  onRejectModeChange,
  onOpenChat,
  onInteractive,
}: TaskDrawerProps) {
  const [rejectModeActive, setRejectModeActive] = useState(false);
  const isMobile = useIsMobile();

  function handleRejectModeChange(active: boolean) {
    setRejectModeActive(active);
    onRejectModeChange?.(active);
  }

  return (
    <Drawer onClose={onClose} disableEscape={rejectModeActive}>
      {task && (
        <ProjectInfoProvider>
          <DrawerTaskProvider taskId={task.id}>
            <HotkeyScope active={!isMobile}>
              <TaskDrawerBody
                task={task}
                allTasks={allTasks}
                onClose={onClose}
                onOpenTask={onOpenTask}
                onRejectModeChange={handleRejectModeChange}
                onOpenChat={onOpenChat}
                onInteractive={onInteractive}
              />
            </HotkeyScope>
          </DrawerTaskProvider>
        </ProjectInfoProvider>
      )}
    </Drawer>
  );
}
