//! Feed view displaying tasks grouped by intent with pipeline bars and status symbols.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useRef, useState } from "react";
import type { WorkflowConfig, WorkflowTaskView } from "../../types/workflow";
import { groupTasksForFeed } from "../../utils/feedGrouping";
import { ModalPanel } from "../ui/ModalPanel";
import { NavigationScope } from "../ui/NavigationScope";
import { TaskDrawer } from "./Drawer/TaskDrawer";
import { FeedHeader } from "./FeedHeader";
import { FeedSection } from "./FeedSection";
import { FeedStatusLine } from "./FeedStatusLine";
import { GitHistoryDrawer } from "./GitHistoryDrawer";
import { NewTaskModal } from "./NewTaskModal";
import { useFeedNavigation } from "./useFeedNavigation";
import { useNewTask } from "./useNewTask";

interface FeedViewProps {
  config: WorkflowConfig;
  tasks: WorkflowTaskView[];
}

export function FeedView({ config, tasks }: FeedViewProps) {
  const feedBodyRef = useRef<HTMLDivElement>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false);

  const panelOpen = activeTaskId !== null || gitHistoryOpen;
  const { isNewTaskOpen, openNewTask, closeNewTask } = useNewTask();

  const drawerOpen = panelOpen || isNewTaskOpen;
  const activeTask = activeTaskId ? (tasks.find((t) => t.id === activeTaskId) ?? null) : null;

  // Derive drawer mode for FeedStatusLine keyboard hints.
  const drawerMode = isNewTaskOpen
    ? ("new-task" as const)
    : gitHistoryOpen
      ? ("git-history" as const)
      : activeTask
        ? activeTask.derived.needs_review
          ? rejectMode
            ? ("review-reject" as const)
            : ("review" as const)
          : activeTask.derived.has_questions
            ? ("answer" as const)
            : activeTask.derived.is_working || activeTask.derived.is_interrupted
              ? ("focus" as const)
              : activeTask.derived.is_done
                ? ("ship" as const)
                : ("focus" as const)
        : null;

  const { sections, subtaskRows } = useMemo(() => groupTasksForFeed(tasks), [tasks]);

  const orderedIds = useMemo(() => {
    const ids: string[] = [];
    for (const section of sections) {
      for (const task of section.tasks) {
        ids.push(task.id);
        for (const sub of subtaskRows.filter((s) => s.parent_id === task.id)) {
          ids.push(sub.id);
        }
      }
    }
    return ids;
  }, [sections, subtaskRows]);

  const onStripRowClick = useCallback((taskId: string) => {
    setGitHistoryOpen(false);
    setActiveTaskId(taskId);
  }, []);

  // Disable feed navigation while the drawer is open; suppress focusedId so row scopes deactivate.
  const {
    focusedId: rawFocusedId,
    setFocusedId,
    scrollSeq,
  } = useFeedNavigation(orderedIds, drawerOpen, onStripRowClick);
  const focusedId = drawerOpen ? null : rawFocusedId;

  const isEmpty = sections.every((s) => s.tasks.length === 0) && subtaskRows.length === 0;

  return (
    <div className="h-full flex flex-col rounded-panel overflow-hidden relative bg-canvas">
      <FeedHeader tasks={tasks} onNewTask={openNewTask} hotkeyActive={!drawerOpen} />
      <div ref={feedBodyRef} className="flex-1 overflow-y-auto">
        <NavigationScope activeId={focusedId} containerRef={feedBodyRef} scrollSeq={scrollSeq}>
          {sections.map((section) => (
            <FeedSection
              key={section.name}
              section={section}
              surfacedSubtasks={subtaskRows}
              config={config}
              focusedId={focusedId}
              onFocusRow={setFocusedId}
              onReview={setActiveTaskId}
              onAnswer={setActiveTaskId}
              onMerge={(taskId) => {
                invoke("workflow_merge_task", { taskId });
              }}
              onOpenPr={(taskId) => {
                invoke("workflow_open_pr", { taskId });
              }}
              onArchive={(taskId) => {
                invoke("workflow_archive", { taskId });
              }}
              onRowClick={onStripRowClick}
            />
          ))}
          {isEmpty && (
            <div className="p-6 text-text-tertiary">
              <p className="font-sans text-sm">No tasks yet</p>
            </div>
          )}
        </NavigationScope>
      </div>
      <FeedStatusLine
        tasks={tasks}
        drawerMode={drawerMode}
        onToggleHistory={() => {
          setGitHistoryOpen((o) => !o);
          setActiveTaskId(null);
        }}
      />
      <ModalPanel
        isOpen={isNewTaskOpen}
        onClose={closeNewTask}
        className="top-[15%] left-0 right-0 mx-auto w-fit"
      >
        {isNewTaskOpen && (
          <NewTaskModal
            config={config}
            onClose={closeNewTask}
            onCreate={async (description, autoMode, baseBranch, flow) => {
              await invoke("workflow_create_task", {
                title: "",
                description,
                baseBranch: baseBranch || null,
                autoMode,
                flow: flow ?? null,
              });
            }}
          />
        )}
      </ModalPanel>
      {gitHistoryOpen && <GitHistoryDrawer onClose={() => setGitHistoryOpen(false)} />}
      {activeTask && (
        <TaskDrawer
          task={activeTask}
          allTasks={tasks}
          onClose={() => setActiveTaskId(null)}
          onOpenTask={setActiveTaskId}
          onRejectModeChange={setRejectMode}
        />
      )}
    </div>
  );
}
