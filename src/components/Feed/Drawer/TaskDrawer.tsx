//! Unified task drawer — adapts to task state (questions, review, working, done, waiting on children).
//! Replaces FocusDrawer, ReviewDrawer, AnswerDrawer, ShipDrawer, and ChildrenDrawer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoScroll } from "../../../hooks/useAutoScroll";
import { useLogs } from "../../../hooks/useLogs";
import { useWorkflowConfig } from "../../../providers";
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
import { availableTabs, currentArtifact, defaultTab, stageReviewType } from "./drawerTabs";
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
}

function TaskDrawerBody({
  task,
  allTasks,
  onClose,
  onOpenTask,
  onRejectModeChange,
}: TaskDrawerBodyProps) {
  const config = useWorkflowConfig();
  const accent = drawerAccent(task, config);

  // -- Tab state --
  const tabs = availableTabs(task);
  const [activeTab, setActiveTab] = useState<DrawerTabId>(() => defaultTab(task));

  // Reset tab when task state type or id changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task state type change
  useEffect(() => {
    setActiveTab(defaultTab(task));
  }, [task.id, task.state.type]);

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
  const showLogs = activeTab === "logs" && selectedRunIdx === null;
  const { logs, error: logsError } = useLogs(task, showLogs);
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
    onInterrupt: state.handleInterrupt,
    onArchive: state.handleArchive,
  });

  // -- Derived --
  const artifact = currentArtifact(task, config);
  const selectedRun = selectedRunIdx !== null ? runs[selectedRunIdx] : null;
  const reviewType = stageReviewType(task, config);

  const breakdownStageName = task.state.type === "waiting_on_children" ? task.state.stage : null;
  const completionStage = breakdownStageName
    ? config.stages.find((s) => s.name === breakdownStageName)?.capabilities.subtasks
        ?.completion_stage
    : null;

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
            logs={logs}
            logsError={logsError}
            logContainerRef={logContainerRef}
            handleLogScroll={handleLogScroll}
            bodyRef={bodyRef}
            state={state}
            onOpenTask={onOpenTask}
          />

          {/* Footer */}
          <DrawerFooter
            task={task}
            activeTab={activeTab}
            questions={task.derived.pending_questions}
            stageReviewType={reviewType}
            completionStage={completionStage}
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
}

export function TaskDrawer({
  task,
  allTasks,
  onClose,
  onOpenTask,
  onRejectModeChange,
}: TaskDrawerProps) {
  const [rejectModeActive, setRejectModeActive] = useState(false);

  function handleRejectModeChange(active: boolean) {
    setRejectModeActive(active);
    onRejectModeChange?.(active);
  }

  return (
    <Drawer onClose={onClose} disableEscape={rejectModeActive}>
      {task && (
        <DrawerTaskProvider taskId={task.id}>
          <HotkeyScope active>
            <TaskDrawerBody
              task={task}
              allTasks={allTasks}
              onClose={onClose}
              onOpenTask={onOpenTask}
              onRejectModeChange={handleRejectModeChange}
            />
          </HotkeyScope>
        </DrawerTaskProvider>
      )}
    </Drawer>
  );
}
