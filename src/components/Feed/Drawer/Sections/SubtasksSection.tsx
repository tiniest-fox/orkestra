//! Section showing a parent task's subtasks grouped by status with keyboard navigation.

import { GitBranch } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { useTasks, useToast, useWorkflowConfig } from "../../../../providers";
import { useTransport } from "../../../../transport";
import type { WorkflowTaskView } from "../../../../types/workflow";
import type {
  FeedSection as FeedSectionData,
  FeedSectionName,
} from "../../../../utils/feedGrouping";
import { isDisconnectError } from "../../../../utils/transportErrors";
import { EmptyState } from "../../../ui/EmptyState";
import { NavigationScope } from "../../../ui/NavigationScope";
import { FeedSection } from "../../FeedSection";
import { useFeedNavigation } from "../../useFeedNavigation";
import { WaitingSection } from "./WaitingSection";

// ============================================================================
// Helpers
// ============================================================================

function byUpdatedAt(a: WorkflowTaskView, b: WorkflowTaskView): number {
  return a.updated_at.localeCompare(b.updated_at);
}

interface GroupResult {
  sections: FeedSectionData[];
  waitingTasks: WorkflowTaskView[];
}

function groupChildren(children: WorkflowTaskView[], allTasks: WorkflowTaskView[]): GroupResult {
  const doneIds = new Set(
    allTasks.filter((t) => t.derived.is_done || t.derived.is_archived).map((t) => t.id),
  );

  const waiting: WorkflowTaskView[] = [];
  const needsReview: WorkflowTaskView[] = [];
  const readyToShip: WorkflowTaskView[] = [];
  const inProgress: WorkflowTaskView[] = [];
  const completed: WorkflowTaskView[] = [];

  for (const child of children) {
    const hasUnfinishedDeps = (child.depends_on ?? []).some((depId) => !doneIds.has(depId));
    if (hasUnfinishedDeps || child.derived.is_blocked) {
      waiting.push(child);
    } else if (
      child.derived.needs_review ||
      child.derived.has_questions ||
      child.derived.is_failed ||
      child.derived.is_interrupted
    ) {
      needsReview.push(child);
    } else if (child.derived.is_done) {
      readyToShip.push(child);
    } else if (child.derived.is_archived) {
      completed.push(child);
    } else {
      inProgress.push(child);
    }
  }

  const sections: Array<{ name: FeedSectionName; label: string; tasks: WorkflowTaskView[] }> = [
    { name: "needs_review", label: "NEEDS REVIEW", tasks: needsReview.sort(byUpdatedAt) },
    { name: "in_progress", label: "IN PROGRESS", tasks: inProgress.sort(byUpdatedAt) },
    { name: "ready_to_ship", label: "READY TO SHIP", tasks: readyToShip.sort(byUpdatedAt) },
    { name: "completed", label: "COMPLETED", tasks: completed.sort(byUpdatedAt) },
  ];

  return { sections, waitingTasks: waiting.sort(byUpdatedAt) };
}

// ============================================================================
// Types
// ============================================================================

interface SubtasksSectionProps {
  task: WorkflowTaskView;
  allTasks: WorkflowTaskView[];
  active: boolean;
  onOpenTask: (id: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function SubtasksSection({ task, allTasks, active, onOpenTask }: SubtasksSectionProps) {
  const transport = useTransport();
  const config = useWorkflowConfig();
  const { showError } = useToast();
  const { applyOptimistic } = useTasks();
  const bodyRef = useRef<HTMLDivElement>(null);

  const children = useMemo(
    () => allTasks.filter((t) => t.parent_id === task.id),
    [allTasks, task.id],
  );

  const { sections, waitingTasks } = useMemo(
    () => groupChildren(children, allTasks),
    [children, allTasks],
  );

  const orderedIds = useMemo(() => {
    const byName = (name: FeedSectionName) =>
      sections.find((s) => s.name === name)?.tasks.map((t) => t.id) ?? [];
    return [
      ...byName("needs_review"),
      ...byName("in_progress"),
      ...waitingTasks.map((t) => t.id),
      ...byName("ready_to_ship"),
      ...byName("completed"),
    ];
  }, [sections, waitingTasks]);

  const handleOpenChild = useCallback(
    (taskId: string) => {
      onOpenTask(taskId);
    },
    [onOpenTask],
  );

  const handleApproveChild = useCallback(
    (taskId: string) => {
      applyOptimistic(taskId, { type: "approve" });
      transport.call("approve", { task_id: taskId }).catch((err) => {
        if (!isDisconnectError(err)) showError(String(err));
      });
    },
    [transport, showError, applyOptimistic],
  );

  const { focusedId, setFocusedId, scrollSeq } = useFeedNavigation(
    orderedIds,
    !active,
    handleOpenChild,
  );

  const sectionsBefore = sections.filter(
    (s) => s.name === "needs_review" || s.name === "in_progress",
  );
  const sectionsAfter = sections.filter(
    (s) => s.name === "ready_to_ship" || s.name === "completed",
  );
  const isEmpty = children.length === 0;

  return (
    <div ref={bodyRef} className="flex-1 overflow-y-auto">
      {isEmpty ? (
        <EmptyState icon={GitBranch} message="No Subtraks yet." />
      ) : (
        <NavigationScope activeId={focusedId} containerRef={bodyRef} scrollSeq={scrollSeq}>
          {sectionsBefore.map((section) => (
            <FeedSection
              key={section.name}
              section={section}
              config={config}
              focusedId={focusedId}
              onFocusRow={setFocusedId}
              onReview={handleOpenChild}
              onAnswer={handleOpenChild}
              onApprove={handleApproveChild}
              onMerge={handleOpenChild}
              onOpenPr={handleOpenChild}
              onRowClick={handleOpenChild}
            />
          ))}
          <WaitingSection
            tasks={waitingTasks}
            allTasks={allTasks}
            config={config}
            focusedId={focusedId}
            onFocusRow={setFocusedId}
            onAction={handleOpenChild}
          />
          {sectionsAfter.map((section) => (
            <FeedSection
              key={section.name}
              section={section}
              config={config}
              focusedId={focusedId}
              onFocusRow={setFocusedId}
              onReview={handleOpenChild}
              onAnswer={handleOpenChild}
              onApprove={handleApproveChild}
              onMerge={handleOpenChild}
              onOpenPr={handleOpenChild}
              onRowClick={handleOpenChild}
            />
          ))}
        </NavigationScope>
      )}
    </div>
  );
}
