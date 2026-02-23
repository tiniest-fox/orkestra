//! Unified task drawer — adapts to task state (questions, review, working, done, waiting on children).
//! Replaces FocusDrawer, ReviewDrawer, AnswerDrawer, ShipDrawer, and ChildrenDrawer.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { useLogs } from "../../hooks/useLogs";
import { useWorkflowConfig } from "../../providers";
import { artifactName } from "../../types/workflow";
import type {
  WorkflowArtifact,
  WorkflowConfig,
  WorkflowQuestion,
  WorkflowTaskView,
} from "../../types/workflow";
import type { FeedSection as FeedSectionData, FeedSectionName } from "../../utils/feedGrouping";
import { groupIterationsIntoRuns } from "../../utils/stageRuns";
import { openExternal } from "../../utils/openExternal";
import { ActivityLog } from "./ActivityLog";
import { DrawerPrTab } from "./DrawerPrTab";
import type { PrTabFooterState } from "./DrawerPrTab";
import { DrawerDiffTab } from "./DrawerDiffTab";
import { DrawerHeader, drawerAccent } from "./DrawerHeader";
import { DrawerTabBar } from "./DrawerTabBar";
import type { DrawerTab } from "./DrawerTabBar";
import { DrawerTaskProvider } from "./DrawerTaskProvider";
import { FeedLogList } from "./FeedLogList";
import { FeedSection } from "./FeedSection";
import { FeedTaskRow } from "./FeedTaskRow";
import { HistoricalRunView } from "./HistoricalRunView";
import { QuestionCard } from "./QuestionCard";
import { useFeedNavigation } from "./useFeedNavigation";
import { useRunNavigation } from "./useRunNavigation";
import { ArtifactView } from "../TaskDetail/ArtifactView";
import { Drawer } from "../ui/Drawer/Drawer";
import { HotkeyButton } from "../ui/HotkeyButton";
import { HotkeyScope, useNavHandler } from "../ui/HotkeyScope";
import { Kbd } from "../ui/Kbd";
import { NavigationScope } from "../ui/NavigationScope";

// ============================================================================
// Types
// ============================================================================

type DrawerTabId = "questions" | "subtasks" | "logs" | "diff" | "artifact" | "history" | "pr";

/** A single navigable item in the flat keyboard nav list for questions. */
type FlatItem =
  | { type: "option"; qIdx: number; optIdx: number }
  | { type: "textarea"; qIdx: number };

// ============================================================================
// Helpers
// ============================================================================

function currentArtifact(task: WorkflowTaskView, config: WorkflowConfig): WorkflowArtifact | null {
  const stageEntry = config.stages.find((s) => s.name === task.derived.current_stage);
  if (!stageEntry) return null;
  return task.artifacts[artifactName(stageEntry.artifact)] ?? null;
}

type StageReviewType = "violet" | "teal";

function stageReviewType(task: WorkflowTaskView, config: WorkflowConfig): StageReviewType {
  const stage = config.stages.find((s) => s.name === task.derived.current_stage);
  return stage?.capabilities.subtasks ? "teal" : "violet";
}

function defaultTab(task: WorkflowTaskView): DrawerTabId {
  if (task.derived.has_questions) return "questions";
  if (task.derived.needs_review) return "artifact";
  if (task.derived.is_working || task.derived.is_interrupted) return "logs";
  if (task.derived.is_done) return task.pr_url ? "pr" : "diff";
  if (task.derived.is_waiting_on_children) return "subtasks";
  return "logs";
}

function availableTabs(task: WorkflowTaskView): DrawerTab[] {
  if (task.derived.has_questions) {
    return [
      { id: "questions", label: "Questions", hotkey: "q" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "history", label: "History", hotkey: "h" },
    ];
  }
  if (task.derived.is_waiting_on_children) {
    return [
      { id: "subtasks", label: "Subtasks", hotkey: "t" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "history", label: "History", hotkey: "h" },
    ];
  }
  if (task.derived.is_done) {
    if (task.pr_url) {
      return [
        { id: "pr", label: "PR", hotkey: "p" },
        { id: "diff", label: "Diff", hotkey: "d" },
        { id: "artifact", label: "Artifact", hotkey: "a" },
        { id: "history", label: "History", hotkey: "h" },
      ];
    }
    return [
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "artifact", label: "Artifact", hotkey: "a" },
      { id: "history", label: "History", hotkey: "h" },
    ];
  }
  if (task.derived.needs_review) {
    return [
      { id: "artifact", label: "Artifact", hotkey: "a" },
      { id: "diff", label: "Diff", hotkey: "d" },
      { id: "logs", label: "Logs", hotkey: "l" },
      { id: "history", label: "History", hotkey: "h" },
    ];
  }
  return [
    { id: "logs", label: "Logs", hotkey: "l" },
    { id: "diff", label: "Diff", hotkey: "d" },
    { id: "artifact", label: "Artifact", hotkey: "a" },
    { id: "history", label: "History", hotkey: "h" },
  ];
}

// ============================================================================
// Button style constants
// ============================================================================

const base =
  "inline-flex items-center font-forge-sans text-[13px] font-semibold px-4 py-[7px] rounded-md border cursor-pointer transition-colors whitespace-nowrap leading-snug disabled:opacity-40 disabled:cursor-not-allowed";
const btnSecondary = `${base} bg-transparent border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--text-3)]`;
const btnBlue = `${base} bg-[var(--blue)]  hover:bg-[var(--blue-hover)]   text-white border-transparent`;
const btnMerge = `${base} bg-[var(--peach)] hover:bg-[var(--peach-hover)]  text-white border-transparent`;
const btnOpenPr = `${base} bg-transparent border-[var(--peach-border)] text-[var(--peach)] hover:bg-[var(--peach-bg)]`;
const btnAmber = `${base} bg-[var(--amber)] hover:opacity-90 text-white border-transparent`;

const btnApproveFor: Record<StageReviewType, string> = {
  violet: `${base} bg-[var(--violet)] hover:bg-[var(--violet-hover)] text-white border-transparent`,
  teal: `${base} bg-[var(--teal)]   hover:bg-[var(--teal-hover)]   text-white border-transparent`,
};

// ============================================================================
// Children grouping helpers (from ChildrenDrawer)
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
      child.derived.is_failed
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
// WaitingSection (internal)
// ============================================================================

function WaitingSection({
  tasks,
  allTasks,
  config,
  focusedId,
  onFocusRow,
  onAction,
}: {
  tasks: WorkflowTaskView[];
  allTasks: WorkflowTaskView[];
  config: WorkflowConfig;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
  onAction: (id: string) => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <div>
      <div className="sticky top-0 z-10 px-6 pt-4 bg-[var(--canvas)]">
        <div className="flex items-baseline gap-2">
          <span className="font-forge-mono text-[10px] font-semibold tracking-[0.10em] uppercase text-[var(--accent)]">
            WAITING
          </span>
          <span className="font-forge-mono text-[10px] font-medium text-[var(--text-3)]">
            {tasks.length}
          </span>
        </div>
        <div className="border-b mt-3 border-[var(--border)]" />
      </div>
      <div>
        {tasks.map((task) => {
          const blockingDeps = (task.depends_on ?? [])
            .map((depId) => allTasks.find((t) => t.id === depId))
            .filter(
              (dep): dep is WorkflowTaskView =>
                dep !== undefined && !dep.derived.is_done && !dep.derived.is_archived,
            );

          const blockedReason = task.state.type === "blocked" ? task.state.reason : undefined;

          const actionsSlot =
            blockingDeps.length > 0 ? (
              <div className="flex items-center justify-end gap-1 w-full">
                <span className="font-forge-mono text-[10px] text-[var(--text-3)]">after</span>
                {blockingDeps.map((dep, i) => (
                  <span key={dep.id} className="flex items-center gap-1">
                    {i > 0 && (
                      <span className="font-forge-mono text-[10px] text-[var(--text-3)]">·</span>
                    )}
                    <span className="font-forge-mono text-[10px] text-[var(--text-2)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">
                      {dep.short_id ?? dep.id.split("-").pop()}
                    </span>
                  </span>
                ))}
              </div>
            ) : blockedReason ? (
              <div className="flex items-center justify-end w-full">
                <span className="font-forge-mono text-[10px] text-[var(--text-3)] truncate">
                  {blockedReason}
                </span>
              </div>
            ) : null;

          return (
            <FeedTaskRow
              key={task.id}
              task={task}
              config={config}
              isFocused={focusedId === task.id}
              onMouseEnter={() => onFocusRow(task.id)}
              onReview={() => onAction(task.id)}
              onAnswer={() => onAction(task.id)}
              onMerge={() => onAction(task.id)}
              onOpenPr={() => onAction(task.id)}
              onClick={() => onAction(task.id)}
              actionsSlot={actionsSlot}
            />
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// QuestionsSection (internal)
// ============================================================================

interface QuestionsSectionProps {
  task: WorkflowTaskView;
  questions: WorkflowQuestion[];
  answers: string[];
  setAnswer: (index: number, value: string) => void;
  onFocusSubmit: () => void;
  loading: boolean;
}

function QuestionsSection({
  task,
  questions,
  answers,
  setAnswer,
  onFocusSubmit,
  loading,
}: QuestionsSectionProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [flatIdx, setFlatIdx] = useState(0);
  const [scrollSeq, setScrollSeq] = useState(0);
  const [cursorTarget, setCursorTarget] = useState<{ qIdx: number; char: string } | null>(null);
  const textareaRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setFlatIdx(0);
    setScrollSeq(0);
    setCursorTarget(null);
    textareaRefs.current.clear();
  }, [task.id]);

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      if (q.options && q.options.length > 0) {
        for (let oi = 0; oi < q.options.length; oi++) {
          items.push({ type: "option", qIdx: qi, optIdx: oi });
        }
      }
      items.push({ type: "textarea", qIdx: qi });
    }
    return items;
  }, [questions]);

  const questionFlatStart = useMemo(() => {
    const starts: number[] = [];
    let count = 0;
    for (let qi = 0; qi < questions.length; qi++) {
      starts.push(count);
      const q = questions[qi];
      count += (q.options?.length ?? 0) + 1;
    }
    return starts;
  }, [questions]);

  function advanceFromQuestion(qi: number) {
    if (qi + 1 < questions.length) {
      setFlatIdx(questionFlatStart[qi + 1]);
      setScrollSeq((n) => n + 1);
    } else {
      onFocusSubmit();
    }
  }

  function handleSetAnswer(index: number, value: string) {
    setAnswer(index, value);
    const isOptionSelected = questions[index]?.options?.some((o) => o.label === value);
    if (isOptionSelected && value.trim().length > 0) {
      setTimeout(() => advanceFromQuestion(index), 320);
    }
  }

  // After "type to enter": focus the textarea and position cursor at end.
  useLayoutEffect(() => {
    if (!cursorTarget) return;
    const el = textareaRefs.current.get(cursorTarget.qIdx);
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    setCursorTarget(null);
  }, [cursorTarget]);

  function textareaHasFocus() {
    return document.activeElement instanceof HTMLTextAreaElement;
  }

  useNavHandler("ArrowDown", () => {
    if (textareaHasFocus()) return;
    setFlatIdx((i) => Math.min(i + 1, flatItems.length - 1));
    setScrollSeq((n) => n + 1);
  });
  useNavHandler("ArrowUp", () => {
    if (textareaHasFocus()) return;
    setFlatIdx((i) => Math.max(i - 1, 0));
    setScrollSeq((n) => n + 1);
  });

  function selectFocused() {
    if (textareaHasFocus()) return;
    const item = flatItems[flatIdx];
    if (!item) return;
    if (item.type === "option") {
      const optLabel = questions[item.qIdx].options![item.optIdx].label;
      handleSetAnswer(item.qIdx, answers[item.qIdx] === optLabel ? "" : optLabel);
    }
  }
  useNavHandler("Enter", selectFocused);
  useNavHandler(" ", selectFocused);

  // "Type to enter" — when flatIdx points at a textarea and no textarea has DOM focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (loading) return;
      if (textareaHasFocus()) return;
      const item = flatItems[flatIdx];
      if (!item || item.type !== "textarea") return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const qi = item.qIdx;
      const prev = answers[qi] ?? "";
      const currentVal = questions[qi]?.options?.some((o) => o.label === prev) ? "" : prev;
      handleSetAnswer(qi, currentVal + e.key);
      setCursorTarget({ qIdx: qi, char: e.key });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — handleSetAnswer is stable via closure
  }, [flatIdx, flatItems, answers, questions, loading]);

  const activeQuestionId = flatItems[flatIdx] ? String(flatItems[flatIdx].qIdx) : undefined;

  if (questions.length === 0) {
    return (
      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        <div className="p-6 font-forge-mono text-[11px] text-[var(--text-3)]">No questions.</div>
      </div>
    );
  }

  return (
    <div ref={bodyRef} className="flex-1 overflow-y-auto">
      <NavigationScope
        activeId={activeQuestionId}
        containerRef={bodyRef}
        buffer={48}
        scrollSeq={scrollSeq}
      >
        <div className="divide-y divide-[var(--border)]">
          {questions.map((q, qi) => (
            <QuestionCard
              key={qi}
              index={qi}
              question={q}
              value={answers[qi] ?? ""}
              onChange={(val) => handleSetAnswer(qi, val)}
              keyboardFlatIdx={flatIdx}
              flatStartIndex={questionFlatStart[qi]}
              textareaRef={(el) => {
                if (el) textareaRefs.current.set(qi, el);
                else textareaRefs.current.delete(qi);
              }}
              onOptionClick={(optIdx) => setFlatIdx(questionFlatStart[qi] + optIdx)}
              onOptionHover={(optIdx) => {
                if (textareaHasFocus()) return;
                setFlatIdx(questionFlatStart[qi] + optIdx);
              }}
              onTextareaFocus={() => setFlatIdx(questionFlatStart[qi] + (q.options?.length ?? 0))}
              onTextareaHover={() => {
                if (textareaHasFocus()) return;
                setFlatIdx(questionFlatStart[qi] + (q.options?.length ?? 0));
              }}
              onTextareaEnter={() => {
                if ((answers[qi] ?? "").trim().length > 0) {
                  advanceFromQuestion(qi);
                }
              }}
              onTextareaEscape={() => handleSetAnswer(qi, "")}
            />
          ))}
        </div>
      </NavigationScope>
    </div>
  );
}

// ============================================================================
// SubtasksSection (internal)
// ============================================================================

interface SubtasksSectionProps {
  task: WorkflowTaskView;
  allTasks: WorkflowTaskView[];
  active: boolean;
  onOpenTask: (id: string) => void;
}

function SubtasksSection({ task, allTasks, active, onOpenTask }: SubtasksSectionProps) {
  const config = useWorkflowConfig();
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
        <div className="p-6 font-forge-mono text-[11px] text-[var(--text-3)]">No subtasks yet.</div>
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

  // -- Answers (questions tab) --
  const questions = task.derived.pending_questions;
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setAnswers(task.derived.pending_questions.map(() => ""));
  }, [task.id]);

  const answeredCount = answers.filter((a) => a.trim().length > 0).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  function setAnswer(index: number, value: string) {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  // -- Reject mode (review tab) --
  const [rejectMode, setRejectMode] = useState(false);
  const [feedback, setFeedback] = useState("");

  function enterRejectMode() {
    setRejectMode(true);
  }

  function exitRejectMode() {
    setRejectMode(false);
    setFeedback("");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setRejectMode(false);
    setFeedback("");
  }, [task.id]);

  useEffect(() => {
    onRejectModeChange?.(rejectMode);
  }, [rejectMode, onRejectModeChange]);

  // -- Resume message (interrupted) --
  const [resumeMessage, setResumeMessage] = useState("");
  const resumeTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus resume textarea when interrupted state appears.
  useEffect(() => {
    if (task.derived.is_interrupted) {
      resumeTextareaRef.current?.focus();
    }
  }, [task.derived.is_interrupted]);

  // -- Feedback input auto-focus when entering reject mode --
  const feedbackRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rejectMode) feedbackRef.current?.focus();
  }, [rejectMode]);

  // -- Submit button ref for questions --
  const submitRef = useRef<HTMLButtonElement>(null);

  // -- Loading state --
  const [loading, setLoading] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setLoading(false);
  }, [task.id]);

  // -- PR tab state (drives footer) --
  const [prTabState, setPrTabState] = useState<PrTabFooterState>({ type: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setPrTabState({ type: "loading" });
  }, [task.id]);

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
  useNavHandler("ArrowDown", () =>
    activeScrollRef.current?.scrollBy({ top: 56, behavior: "smooth" }),
  );
  useNavHandler("j", () => activeScrollRef.current?.scrollBy({ top: 56, behavior: "smooth" }));
  useNavHandler("ArrowUp", () =>
    activeScrollRef.current?.scrollBy({ top: -56, behavior: "smooth" }),
  );
  useNavHandler("k", () => activeScrollRef.current?.scrollBy({ top: -56, behavior: "smooth" }));
  useNavHandler("l", () => {
    if (selectedRunIdx === null) setActiveTab("logs");
  });
  useNavHandler("d", () => {
    if (selectedRunIdx === null) setActiveTab("diff");
  });
  useNavHandler("a", () => {
    if (selectedRunIdx === null) setActiveTab("artifact");
  });
  useNavHandler("h", () => {
    if (selectedRunIdx === null) setActiveTab("history");
  });
  useNavHandler("q", () => {
    if (task.derived.has_questions && selectedRunIdx === null) setActiveTab("questions");
  });
  useNavHandler("t", () => {
    if (task.derived.is_waiting_on_children && selectedRunIdx === null) setActiveTab("subtasks");
  });
  useNavHandler("p", () => {
    if (task.derived.is_done && task.pr_url && selectedRunIdx === null) setActiveTab("pr");
  });
  useNavHandler("i", () => {
    if (task.derived.is_working) handleInterrupt();
  });
  useNavHandler("x", () => {
    if (task.derived.is_done) handleArchive();
  });
  useRunNavigation(runs, selectedRunIdx, setSelectedRunIdx, task.derived.is_waiting_on_children);

  // -- Action handlers --

  const handleApprove = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await invoke("workflow_approve", { taskId: task.id });
      onClose();
    } catch (err) {
      console.error("Failed to approve:", err);
      setLoading(false);
    }
  }, [task.id, loading, onClose]);

  const handleReject = useCallback(async () => {
    if (loading || !feedback.trim()) return;
    setLoading(true);
    try {
      await invoke("workflow_reject", { taskId: task.id, feedback: feedback.trim() });
      onClose();
    } catch (err) {
      console.error("Failed to reject:", err);
      setLoading(false);
    }
  }, [task.id, feedback, loading, onClose]);

  const [interrupting, setInterrupting] = useState(false);
  const handleInterrupt = useCallback(async () => {
    if (interrupting) return;
    setInterrupting(true);
    try {
      await invoke("workflow_interrupt", { taskId: task.id });
    } catch (err) {
      console.error("Failed to interrupt:", err);
    } finally {
      setInterrupting(false);
    }
  }, [task.id, interrupting]);

  const [resuming, setResuming] = useState(false);
  const handleResume = useCallback(async () => {
    if (resuming) return;
    setResuming(true);
    try {
      await invoke("workflow_resume", { taskId: task.id, message: resumeMessage.trim() || null });
      setResumeMessage("");
      onClose();
    } catch (err) {
      console.error("Failed to resume:", err);
      setResuming(false);
    }
  }, [task.id, resumeMessage, resuming, onClose]);

  const handleMerge = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await invoke("workflow_merge_task", { taskId: task.id });
      onClose();
    } catch (err) {
      console.error("Failed to merge:", err);
      setLoading(false);
    }
  }, [task.id, loading, onClose]);

  const handleOpenPr = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await invoke("workflow_open_pr", { taskId: task.id });
      onClose();
    } catch (err) {
      console.error("Failed to open PR:", err);
      setLoading(false);
    }
  }, [task.id, loading, onClose]);

  const handleArchive = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await invoke("workflow_archive", { taskId: task.id });
      onClose();
    } catch (err) {
      console.error("Failed to archive:", err);
      setLoading(false);
    }
  }, [task.id, loading, onClose]);

  const handleFixConflicts = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await invoke("workflow_address_pr_conflicts", {
        taskId: task.id,
        baseBranch: `origin/${task.base_branch}`,
      });
      onClose();
    } catch (err) {
      console.error("Failed to fix conflicts:", err);
      setLoading(false);
    }
  }, [task.id, task.base_branch, loading, onClose]);

  const handleAddressComments = useCallback(async () => {
    if (loading || prTabState.type !== "comments_selected") return;
    setLoading(true);
    try {
      await invoke("workflow_address_pr_comments", {
        taskId: task.id,
        comments: prTabState.comments,
        guidance: prTabState.guidance || null,
      });
      onClose();
    } catch (err) {
      console.error("Failed to address comments:", err);
      setLoading(false);
    }
  }, [task.id, loading, prTabState, onClose]);

  const handleSubmitAnswers = useCallback(async () => {
    if (loading || !allAnswered) return;
    setLoading(true);
    try {
      const now = new Date().toISOString();
      await invoke("workflow_answer_questions", {
        taskId: task.id,
        answers: questions.map((q, i) => ({
          question: q.question,
          answer: answers[i].trim(),
          answered_at: now,
        })),
      });
      onClose();
    } catch (err) {
      console.error("Failed to submit answers:", err);
      setLoading(false);
    }
  }, [task.id, questions, answers, allAnswered, loading, onClose]);

  // -- Derived --
  const artifact = currentArtifact(task, config);
  const selectedRun = selectedRunIdx !== null ? runs[selectedRunIdx] : null;
  const btnApprove = btnApproveFor[stageReviewType(task, config)];

  const breakdownStageName = task.state.type === "waiting_on_children" ? task.state.stage : null;
  const completionStage = breakdownStageName
    ? config.stages.find((s) => s.name === breakdownStageName)?.capabilities.subtasks
        ?.completion_stage
    : null;

  const progress = task.derived.subtask_progress;

  // onProgressClick: when viewing historical run, clicking the subtask bar returns to subtasks tab.
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
  const isWaitingChipSelected = selectedRunIdx === null;

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
          task.derived.is_waiting_on_children ? isWaitingChipSelected : undefined
        }
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
          {activeTab === "diff" ? (
            <DrawerDiffTab active={activeTab === "diff"} />
          ) : activeTab === "logs" ? (
            <div
              ref={logContainerRef}
              onScroll={handleLogScroll}
              className="flex-1 overflow-y-auto p-4"
            >
              <FeedLogList logs={logs} error={logsError} />
            </div>
          ) : activeTab === "artifact" ? (
            <div ref={bodyRef} className="flex-1 overflow-y-auto">
              {artifact ? (
                <ArtifactView artifact={artifact} />
              ) : (
                <div className="p-6 font-forge-mono text-[11px] text-[var(--text-3)]">
                  No artifact yet.
                </div>
              )}
            </div>
          ) : activeTab === "history" ? (
            <div ref={bodyRef} className="flex-1 overflow-y-auto">
              <ActivityLog iterations={task.iterations} />
            </div>
          ) : activeTab === "questions" ? (
            <QuestionsSection
              task={task}
              questions={questions}
              answers={answers}
              setAnswer={setAnswer}
              onFocusSubmit={() => submitRef.current?.focus()}
              loading={loading}
            />
          ) : activeTab === "subtasks" ? (
            <SubtasksSection
              task={task}
              allTasks={allTasks}
              active={activeTab === "subtasks"}
              onOpenTask={onOpenTask}
            />
          ) : activeTab === "pr" && task.pr_url ? (
            <DrawerPrTab
              taskId={task.id}
              prUrl={task.pr_url}
              baseBranch={task.base_branch}
              onPrStateChange={setPrTabState}
            />
          ) : null}

          {/* Footer */}
          {task.derived.has_questions && activeTab === "questions" ? (
            <div className="shrink-0 px-6 border-t border-[var(--border)] flex items-center gap-2.5 h-[52px]">
              <HotkeyButton
                ref={submitRef}
                hotkey="s"
                onAccent
                className={btnBlue}
                onClick={handleSubmitAnswers}
                disabled={!allAnswered || loading}
              >
                Submit {questions.length === 1 ? "answer" : "answers"}
              </HotkeyButton>
              {questions.length > 1 && (
                <span className="ml-auto font-forge-mono text-[11px] text-[var(--text-3)]">
                  {answeredCount} of {questions.length} answered
                </span>
              )}
            </div>
          ) : task.derived.needs_review && rejectMode ? (
            <div className="shrink-0 px-6 border-t border-[var(--border)] flex items-center gap-2.5 h-[52px]">
              <input
                ref={feedbackRef}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleReject();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    exitRejectMode();
                  }
                }}
                placeholder="What needs to change?"
                className="flex-1 font-forge-sans text-[12px] text-[var(--text-0)] placeholder:text-[var(--text-3)] bg-[var(--surface-2)] border border-[var(--border)] rounded-md px-3 py-1.5 outline-none focus:border-[var(--text-3)] transition-colors"
              />
              <button
                className={btnApprove}
                onClick={handleReject}
                disabled={loading || !feedback.trim()}
              >
                Send feedback
              </button>
              <button className={btnSecondary} onClick={exitRejectMode} disabled={loading}>
                Cancel
              </button>
            </div>
          ) : task.derived.needs_review && !rejectMode ? (
            <div className="shrink-0 px-6 border-t border-[var(--border)] flex items-center gap-2.5 h-[52px]">
              <HotkeyButton
                hotkey="a"
                onAccent
                className={btnApprove}
                onClick={handleApprove}
                disabled={loading}
              >
                Approve
              </HotkeyButton>
              <HotkeyButton
                hotkey="r"
                className={btnSecondary}
                onClick={enterRejectMode}
                disabled={loading}
              >
                Reject
              </HotkeyButton>
            </div>
          ) : task.derived.is_interrupted ? (
            <div className="shrink-0 border-t border-[var(--border)] px-4 py-3 flex flex-col gap-2">
              <textarea
                ref={resumeTextareaRef}
                value={resumeMessage}
                onChange={(e) => setResumeMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleResume();
                  }
                }}
                placeholder="Optional guidance for the agent…"
                rows={2}
                className="w-full font-forge-sans text-forge-body text-[var(--text-0)] placeholder:text-[var(--text-3)] bg-[var(--surface-2)] border border-[var(--border)] rounded px-3 py-2 resize-none focus:outline-none focus:border-[var(--text-2)] transition-colors"
              />
              <button
                onClick={handleResume}
                disabled={resuming}
                className="inline-flex items-center justify-between font-forge-sans text-[13px] font-semibold px-4 py-[7px] rounded-md border cursor-pointer transition-colors whitespace-nowrap leading-snug disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--accent)] border-[var(--accent)] text-white hover:opacity-90"
              >
                {resuming ? "Resuming…" : "Resume"}
                {!resuming && (
                  <span className="font-forge-mono text-[10px] font-medium opacity-60">⌘↵</span>
                )}
              </button>
            </div>
          ) : task.derived.is_working && !task.derived.is_interrupted ? (
            <div className="shrink-0 px-6 border-t border-[var(--border)] flex items-center h-[52px]">
              <button
                onClick={handleInterrupt}
                disabled={interrupting}
                className="inline-flex items-center gap-2 font-forge-sans text-[13px] font-semibold px-4 py-[7px] rounded-md border cursor-pointer transition-colors whitespace-nowrap leading-snug disabled:opacity-40 disabled:cursor-not-allowed bg-transparent border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--text-3)]"
              >
                {interrupting ? "Interrupting…" : "Interrupt"}
                {!interrupting && <Kbd>i</Kbd>}
              </button>
            </div>
          ) : task.derived.is_done ? (
            <div className="shrink-0 px-6 border-t border-[var(--border)] flex items-center gap-2.5 h-[52px]">
              {task.pr_url ? (
                // PR-aware footer — four states driven by the PR tab
                activeTab === "pr" && prTabState.type === "conflicts" ? (
                  <>
                    <button className={btnAmber} onClick={handleFixConflicts} disabled={loading}>
                      {loading ? "Fixing…" : "Fix Conflicts"}
                    </button>
                    <HotkeyButton
                      hotkey="v"
                      className={btnSecondary}
                      onClick={() => openExternal(task.pr_url!)}
                    >
                      View PR ↗
                    </HotkeyButton>
                  </>
                ) : activeTab === "pr" && prTabState.type === "comments_selected" ? (
                  <>
                    <button className={btnMerge} onClick={handleAddressComments} disabled={loading}>
                      {loading
                        ? "Sending…"
                        : `Address ${prTabState.count} comment${prTabState.count !== 1 ? "s" : ""}`}
                    </button>
                    <HotkeyButton
                      hotkey="v"
                      className={btnSecondary}
                      onClick={() => openExternal(task.pr_url!)}
                    >
                      View PR ↗
                    </HotkeyButton>
                  </>
                ) : (
                  <>
                    <HotkeyButton
                      hotkey="m"
                      className={btnMerge}
                      onAccent
                      onClick={handleMerge}
                      disabled={loading}
                    >
                      {loading ? "Merging…" : "Merge"}
                    </HotkeyButton>
                    <HotkeyButton
                      hotkey="v"
                      className={btnOpenPr}
                      onClick={() => openExternal(task.pr_url!)}
                    >
                      View PR ↗
                    </HotkeyButton>
                    <HotkeyButton
                      hotkey="x"
                      className={btnSecondary}
                      onClick={handleArchive}
                      disabled={loading}
                    >
                      Archive
                    </HotkeyButton>
                  </>
                )
              ) : (
                // No PR yet — offer to open one
                <>
                  <HotkeyButton
                    hotkey="m"
                    className={btnMerge}
                    onAccent
                    onClick={handleMerge}
                    disabled={loading}
                  >
                    {loading ? "Merging…" : "Merge"}
                  </HotkeyButton>
                  <HotkeyButton
                    hotkey="o"
                    className={btnOpenPr}
                    onClick={handleOpenPr}
                    disabled={loading}
                  >
                    {loading ? "Opening…" : "Open PR"}
                  </HotkeyButton>
                  <HotkeyButton
                    hotkey="x"
                    className={btnSecondary}
                    onClick={handleArchive}
                    disabled={loading}
                  >
                    Archive
                  </HotkeyButton>
                </>
              )}
            </div>
          ) : task.derived.is_waiting_on_children && progress ? (
            <div className="shrink-0 px-6 border-t border-[var(--border)] flex items-center gap-2 h-[52px]">
              <span className="font-forge-mono text-[11px] text-[var(--text-2)]">
                {progress.done} of {progress.total} complete
              </span>
              {completionStage && (
                <>
                  <span className="font-forge-mono text-[11px] text-[var(--text-3)]">·</span>
                  <span className="font-forge-mono text-[11px] text-[var(--text-3)]">
                    resumes at <span className="text-[var(--text-2)]">{completionStage}</span>
                  </span>
                </>
              )}
              {progress.failed > 0 && (
                <span className="ml-auto font-forge-mono text-[11px] text-[var(--red)]">
                  {progress.failed} failed
                </span>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ============================================================================
// TaskDrawer (public export)
// ============================================================================

interface TaskDrawerProps {
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
  // Track reject mode to pass disableEscape to Drawer and propagate upward.
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
