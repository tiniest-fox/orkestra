/**
 * Main application content. Only rendered after startup succeeds.
 * Uses Panel-based design system with animated sidebar transitions.
 * Navigation state is driven by DisplayContext.
 */

import { useMemo } from "react";
import { useFocusTaskListener } from "../hooks/useFocusTaskListener";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import {
  useAssistant,
  useAutoTaskTemplates,
  useDisplayContext,
  useTasks,
  useWorkflowConfig,
} from "../providers";
import type { AutoTaskTemplate, WorkflowTask, WorkflowTaskView } from "../types/workflow";
import { ArchivedListView } from "./ArchivedListView";
import { ArchiveTaskDetailView } from "./ArchiveTaskDetailView";
import { AssistantPanel, SessionHistory } from "./Assistant";
import { BranchIndicator } from "./BranchIndicator";
import { CommandPalette } from "./CommandPalette";
import { CommitDiffPanel, CommitHistoryPanel } from "./CommitHistory";
import { DiffPanel } from "./Diff";
import { KanbanBoard } from "./Kanban";
import { NewTaskPanel } from "./NewTaskPanel";
import { TaskDetailSidebar } from "./TaskDetail";
import { Button, Panel, PanelLayout, Slot } from "./ui";

export function Orkestra() {
  useNotificationPermission();
  useFocusTaskListener();

  const {
    layout,
    activePreset,
    showTask,
    showSubtask,
    closeSubtask,
    showNewTask,
    closeFocus,
    closeDiff,
    toggleAssistant,
    toggleAssistantHistory,
    closeAssistantHistory,
    switchToActive,
    switchToArchive,
    selectCommit,
    deselectCommit,
    toggleGitHistory,
  } = useDisplayContext();

  const config = useWorkflowConfig();
  const autoTaskTemplates = useAutoTaskTemplates();
  const { tasks, archivedTasks, loading, error, createTask, deleteTask } = useTasks();
  const { sessions, activeSession, selectSession } = useAssistant();

  // Filter to top-level tasks only
  const topLevelTasks = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks]);

  // Filter active tasks (non-archived top-level)
  const activeTasks = useMemo(
    () => topLevelTasks.filter((t) => !t.derived.is_archived),
    [topLevelTasks],
  );

  // Archived tasks now come from the provider directly
  const archivedTopLevelTasks = useMemo(
    () =>
      archivedTasks
        .filter((t) => !t.parent_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [archivedTasks],
  );

  const { content, panel, secondaryPanel } = activePreset;

  // Look up selected task from both active and archived lists
  const currentSelectedTask: WorkflowTaskView | null = useMemo(() => {
    if (!layout.taskId) return null;
    return (
      topLevelTasks.find((t) => t.id === layout.taskId) ??
      archivedTopLevelTasks.find((t) => t.id === layout.taskId) ??
      null
    );
  }, [layout.taskId, topLevelTasks, archivedTopLevelTasks]);

  // Derive subtasks for the selected parent from active or archived lists
  const currentSubtasks = useMemo(() => {
    if (!currentSelectedTask) return [];
    // If parent is archived, look in archived tasks for subtasks
    if (currentSelectedTask.derived.is_archived) {
      return archivedTasks.filter((t) => t.parent_id === currentSelectedTask.id);
    }
    // Otherwise look in active tasks
    return tasks.filter((t) => t.parent_id === currentSelectedTask.id);
  }, [currentSelectedTask, tasks, archivedTasks]);

  const currentSelectedSubtask: WorkflowTaskView | null = layout.subtaskId
    ? (currentSubtasks.find((t) => t.id === layout.subtaskId) ?? null)
    : null;

  const handleSelectTask = (task: WorkflowTask) => {
    showTask(task.id);
  };

  const handleSelectSubtask = (subtask: WorkflowTaskView) => {
    if (layout.taskId) {
      showSubtask(layout.taskId, subtask.id);
    }
  };

  const handleCloseSubtask = () => {
    closeSubtask();
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      closeFocus();
    } catch (err) {
      console.error("[handleDeleteTask] Delete failed:", err);
    }
  };

  const handleTaskCreated = async (
    description: string,
    autoMode: boolean,
    baseBranch: string | null,
    flow?: string,
  ) => {
    await createTask("", description, autoMode, baseBranch, flow);
    closeFocus();
  };

  const handleAutoTask = async (template: AutoTaskTemplate) => {
    await createTask(
      "",
      template.description,
      template.auto_run,
      undefined,
      template.flow ?? undefined,
    );
  };

  return (
    <div className="w-screen h-screen bg-stone-100 dark:bg-stone-950 flex flex-col items-stretch p-4 gap-4 overflow-clip">
      <div className="flex items-center justify-between px-2 flex-shrink-0 overflow-hidden">
        <div className="flex items-center gap-4">
          <Panel.Title>Orkestra</Panel.Title>
          <Button
            variant={
              layout.preset === "Assistant" || layout.preset === "AssistantHistory"
                ? "primary"
                : "secondary"
            }
            size="sm"
            onClick={toggleAssistant}
          >
            Assistant
          </Button>
          <div className="flex items-center gap-1 bg-stone-200 dark:bg-stone-800 rounded-panel p-0.5">
            <Button
              variant={!layout.isArchive ? "primary" : "secondary"}
              size="sm"
              onClick={switchToActive}
            >
              Active
            </Button>
            <Button
              variant={layout.isArchive ? "primary" : "secondary"}
              size="sm"
              onClick={switchToArchive}
            >
              Archived
            </Button>
          </div>
          <BranchIndicator />
        </div>
        <div className="flex items-center gap-2">
          {autoTaskTemplates.map((template) => (
            <Button
              key={template.filename}
              variant="secondary"
              size="sm"
              onClick={() => handleAutoTask(template)}
            >
              {template.title}
            </Button>
          ))}
          <Button onClick={showNewTask}>+ New Task</Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-panel text-error-700 dark:text-error-300">
          Error loading tasks: {error}
        </div>
      )}

      <PanelLayout className="flex-1">
        {/* LEFT secondaryPanel slot — only SessionHistory goes here */}
        <Slot
          id="left-secondary"
          type="fixed"
          size={320}
          visible={secondaryPanel === "SessionHistory"}
          plain
        >
          {secondaryPanel === "SessionHistory" && (
            <SessionHistory
              sessions={sessions}
              activeSessionId={activeSession?.id ?? null}
              onSelectSession={(session) => {
                selectSession(session);
                closeAssistantHistory();
              }}
              onClose={closeAssistantHistory}
            />
          )}
        </Slot>

        {/* LEFT panel slot — AssistantPanel, GitHistoryPanel */}
        <Slot
          id="left-panel"
          type="fixed"
          size={panel === "GitHistoryPanel" ? 360 : 480}
          visible={panel === "AssistantPanel" || panel === "GitHistoryPanel"}
          plain
        >
          {panel === "AssistantPanel" && (
            <AssistantPanel onClose={toggleAssistant} onToggleHistory={toggleAssistantHistory} />
          )}
          {panel === "GitHistoryPanel" && (
            <CommitHistoryPanel
              selectedCommit={layout.commitHash ?? undefined}
              onSelectCommit={selectCommit}
              onClose={toggleGitHistory}
            />
          )}
        </Slot>

        {/* CONTENT slot — main grow area */}
        <Slot id="content" type="grow" visible={!loading}>
          {content === "KanbanBoard" &&
            (layout.isArchive ? (
              <ArchivedListView
                tasks={archivedTopLevelTasks}
                selectedTaskId={currentSelectedTask?.id}
                onSelectTask={handleSelectTask}
              />
            ) : (
              <KanbanBoard
                config={config}
                tasks={activeTasks}
                selectedTaskId={currentSelectedTask?.id}
                onSelectTask={handleSelectTask}
              />
            ))}
          {content === "DiffPanel" && layout.taskId && (
            <DiffPanel
              taskId={
                layout.subtaskId && layout.preset === "SubtaskDiff"
                  ? layout.subtaskId
                  : layout.taskId
              }
              onClose={closeDiff}
            />
          )}
          {content === "CommitDiffPanel" && layout.commitHash && (
            <CommitDiffPanel commitHash={layout.commitHash} onClose={deselectCommit} />
          )}
        </Slot>

        {/* RIGHT panel slot — TaskDetail, SubtaskDetail, NewTaskPanel */}
        <Slot
          id="right-panel"
          type="fixed"
          size={480}
          visible={panel === "TaskDetail" || panel === "NewTaskPanel" || panel === "SubtaskDetail"}
          contentKey={
            panel === "NewTaskPanel"
              ? "new-task"
              : panel === "TaskDetail"
                ? layout.taskId
                : panel === "SubtaskDetail"
                  ? layout.subtaskId
                  : null
          }
          plain
        >
          {panel === "NewTaskPanel" && (
            <NewTaskPanel onClose={closeFocus} onSubmit={handleTaskCreated} />
          )}
          {panel === "TaskDetail" &&
            currentSelectedTask &&
            (layout.isArchive ? (
              <ArchiveTaskDetailView
                key={currentSelectedTask.id}
                task={currentSelectedTask}
                onClose={closeFocus}
                subtasks={currentSubtasks}
                selectedSubtaskId={layout.subtaskId ?? undefined}
                onSelectSubtask={handleSelectSubtask}
              />
            ) : (
              <TaskDetailSidebar
                key={currentSelectedTask.id}
                task={currentSelectedTask}
                onClose={closeFocus}
                onDelete={() => handleDeleteTask(currentSelectedTask.id)}
                subtasks={currentSubtasks}
                selectedSubtaskId={layout.subtaskId ?? undefined}
                onSelectSubtask={handleSelectSubtask}
              />
            ))}
          {panel === "SubtaskDetail" && currentSelectedSubtask && (
            <TaskDetailSidebar
              key={currentSelectedSubtask.id}
              task={currentSelectedSubtask}
              onClose={handleCloseSubtask}
            />
          )}
        </Slot>

        {/* RIGHT secondaryPanel slot — SubtaskDetail (when shown as secondary) */}
        <Slot
          id="right-secondary"
          type="fixed"
          size={480}
          visible={secondaryPanel === "SubtaskDetail"}
          contentKey={layout.subtaskId}
          plain
        >
          {secondaryPanel === "SubtaskDetail" && currentSelectedSubtask && (
            <TaskDetailSidebar
              key={currentSelectedSubtask.id}
              task={currentSelectedSubtask}
              onClose={handleCloseSubtask}
            />
          )}
        </Slot>
      </PanelLayout>

      <CommandPalette />
    </div>
  );
}
