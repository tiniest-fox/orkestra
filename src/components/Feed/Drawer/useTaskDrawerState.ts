//! State management and action handlers for the TaskDrawer component.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseOptionIndex } from "../../../lib/optionKey";
import type { WorkflowQuestion, WorkflowTaskView } from "../../../types/workflow";
import type { DraftComment, PrTabFooterState } from "./drawerTabs";

// ============================================================================
// Types
// ============================================================================

export interface TaskDrawerState {
  // -- Answers (questions tab) --
  answers: string[];
  setAnswer: (index: number, value: string) => void;
  answeredCount: number;
  allAnswered: boolean;

  // -- Reject mode --
  rejectMode: boolean;
  enterRejectMode: () => void;
  exitRejectMode: () => void;
  feedback: string;
  setFeedback: (v: string) => void;

  // -- Update mode (done tasks) --
  updateMode: boolean;
  enterUpdateMode: () => void;
  exitUpdateMode: () => void;
  updateNotes: string;
  setUpdateNotes: (v: string) => void;
  updateNotesRef: React.RefObject<HTMLTextAreaElement>;
  handleRequestUpdate: () => Promise<void>;

  // -- Resume (interrupted) --
  resumeMessage: string;
  setResumeMessage: (v: string) => void;
  resumeTextareaRef: React.RefObject<HTMLTextAreaElement>;

  // -- Retry (failed) --
  retryInstructions: string;
  setRetryInstructions: (v: string) => void;
  retryTextareaRef: React.RefObject<HTMLTextAreaElement>;
  retrying: boolean;
  handleRetry: () => Promise<void>;

  // -- Loading state --
  loading: boolean;
  interrupting: boolean;
  resuming: boolean;

  // -- PR tab state --
  prTabState: PrTabFooterState;
  setPrTabState: (state: PrTabFooterState) => void;

  // -- Push/pull error --
  pushPullError: string | null;

  // -- Draft line comments --
  draftComments: DraftComment[];
  lineCommentGuidance: string;
  setLineCommentGuidance: (v: string) => void;
  lineCommentError: string | null;
  addDraftComment: (
    filePath: string,
    lineNumber: number,
    lineType: "add" | "delete" | "context",
    body: string,
  ) => void;
  removeDraftComment: (id: string) => void;
  clearDraftComments: () => void;
  submitLineComments: () => Promise<void>;

  // -- Refs --
  feedbackRef: React.RefObject<HTMLInputElement>;
  submitRef: React.RefObject<HTMLButtonElement>;

  // -- Action handlers --
  handleApprove: () => Promise<void>;
  handleReject: () => Promise<void>;
  handleInterrupt: () => Promise<void>;
  handleResume: () => Promise<void>;
  handleMerge: () => Promise<void>;
  handleOpenPr: () => Promise<void>;
  handleArchive: () => Promise<void>;
  handleFixConflicts: () => Promise<void>;
  handleAddressFeedback: () => Promise<void>;
  handlePushPr: () => Promise<void>;
  handlePullPr: () => Promise<void>;
  handleSubmitAnswers: (questions: WorkflowQuestion[]) => Promise<void>;
  handleToggleAutoMode: () => Promise<void>;
  optimisticAutoMode: boolean | null;
}

// ============================================================================
// Helpers
// ============================================================================

function mapDraftsToPrComments(drafts: DraftComment[]) {
  return drafts.map((d) => ({
    author: "User" as const,
    body: d.body,
    path: d.filePath,
    line: d.lineNumber,
  }));
}

// ============================================================================
// Hook
// ============================================================================

export function useTaskDrawerState(task: WorkflowTaskView, onClose: () => void): TaskDrawerState {
  const questions = task.derived.pending_questions;

  // -- Answers --
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

  // -- Reject mode --
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

  // -- Update mode --
  const [updateMode, setUpdateMode] = useState(false);
  const [updateNotes, setUpdateNotes] = useState("");
  const updateNotesRef = useRef<HTMLTextAreaElement>(null);

  function enterUpdateMode() {
    setUpdateMode(true);
  }
  function exitUpdateMode() {
    setUpdateMode(false);
    setUpdateNotes("");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setUpdateMode(false);
    setUpdateNotes("");
  }, [task.id]);

  useEffect(() => {
    if (updateMode) updateNotesRef.current?.focus();
  }, [updateMode]);

  // -- Resume message --
  const [resumeMessage, setResumeMessage] = useState("");
  const resumeTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (task.derived.is_interrupted) resumeTextareaRef.current?.focus();
  }, [task.derived.is_interrupted]);

  // -- Retry instructions --
  const [retryInstructions, setRetryInstructions] = useState("");
  const retryTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [retrying, setRetrying] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setRetryInstructions("");
  }, [task.id]);

  useEffect(() => {
    if (task.derived.is_failed) retryTextareaRef.current?.focus();
  }, [task.derived.is_failed]);

  // -- Feedback input auto-focus --
  const feedbackRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rejectMode) feedbackRef.current?.focus();
  }, [rejectMode]);

  // -- Submit button ref for questions --
  const submitRef = useRef<HTMLButtonElement>(null);

  // -- Loading state --
  const [loading, setLoading] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [resuming, setResuming] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setLoading(false);
  }, [task.id]);

  // -- PR tab state --
  const [prTabState, setPrTabState] = useState<PrTabFooterState>({ type: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setPrTabState({ type: "loading" });
  }, [task.id]);

  // -- Push/pull error --
  const [pushPullError, setPushPullError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setPushPullError(null);
  }, [task.id]);

  // -- Draft line comments --
  const [draftComments, setDraftComments] = useState<DraftComment[]>([]);
  const [lineCommentGuidance, setLineCommentGuidance] = useState("");
  const [lineCommentError, setLineCommentError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setDraftComments([]);
    setLineCommentGuidance("");
    setLineCommentError(null);
  }, [task.id]);

  const addDraftComment = useCallback(
    (
      filePath: string,
      lineNumber: number,
      lineType: "add" | "delete" | "context",
      body: string,
    ) => {
      setDraftComments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), filePath, lineNumber, lineType, body },
      ]);
    },
    [],
  );

  const removeDraftComment = useCallback((id: string) => {
    setDraftComments((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const clearDraftComments = useCallback(() => {
    setDraftComments([]);
    setLineCommentGuidance("");
  }, []);

  const submitLineCommentsForDoneTask = useCallback(async () => {
    if (loading || draftComments.length === 0) return;
    setLineCommentError(null);
    setLoading(true);
    try {
      const comments = mapDraftsToPrComments(draftComments);
      const guidance = lineCommentGuidance.trim() || null;
      await invoke("workflow_address_pr_feedback", {
        taskId: task.id,
        comments,
        checks: [],
        guidance,
      });
      clearDraftComments();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLineCommentError(message);
      setLoading(false);
    }
  }, [task.id, loading, draftComments, lineCommentGuidance, clearDraftComments, onClose]);

  const submitLineCommentsForReview = useCallback(async () => {
    if (loading || draftComments.length === 0) return;
    setLineCommentError(null);
    setLoading(true);
    try {
      const comments = mapDraftsToPrComments(draftComments);
      const guidance = lineCommentGuidance.trim() || null;
      await invoke("workflow_reject_with_comments", { taskId: task.id, comments, guidance });
      clearDraftComments();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLineCommentError(message);
      setLoading(false);
    }
  }, [task.id, loading, draftComments, lineCommentGuidance, clearDraftComments, onClose]);

  const submitLineComments = task.derived.is_done
    ? submitLineCommentsForDoneTask
    : submitLineCommentsForReview;

  // -- Action handlers --

  const invokeAndClose = useCallback(
    async (command: string, args: Record<string, unknown> = {}) => {
      if (loading) return;
      setLoading(true);
      try {
        await invoke(command, { taskId: task.id, ...args });
        onClose();
      } catch (err) {
        console.error(`Failed to ${command}:`, err);
        setLoading(false);
      }
    },
    [task.id, loading, onClose],
  );

  const handleApprove = useCallback(() => invokeAndClose("workflow_approve"), [invokeAndClose]);

  const handleReject = useCallback(async () => {
    if (loading || !feedback.trim()) return;
    setLoading(true);
    try {
      await invoke("workflow_reject", { taskId: task.id, feedback: feedback.trim() });
      onClose();
    } catch (err) {
      console.error("Failed to workflow_reject:", err);
      setLoading(false);
    }
  }, [task.id, feedback, loading, onClose]);

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

  const handleMerge = useCallback(() => invokeAndClose("workflow_merge_task"), [invokeAndClose]);

  const handleOpenPr = useCallback(() => invokeAndClose("workflow_open_pr"), [invokeAndClose]);

  const handleArchive = useCallback(() => invokeAndClose("workflow_archive"), [invokeAndClose]);

  const handleFixConflicts = useCallback(
    () =>
      invokeAndClose("workflow_address_pr_conflicts", { baseBranch: `origin/${task.base_branch}` }),
    [invokeAndClose, task.base_branch],
  );

  const handlePushPr = useCallback(async () => {
    if (loading) return;
    setPushPullError(null);
    setLoading(true);
    try {
      await invoke("workflow_push_pr_changes", { taskId: task.id });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPushPullError(message);
      setLoading(false);
    }
  }, [task.id, loading, onClose]);

  const handlePullPr = useCallback(async () => {
    if (loading) return;
    setPushPullError(null);
    setLoading(true);
    try {
      await invoke("workflow_pull_pr_changes", { taskId: task.id });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPushPullError(message);
      setLoading(false);
    }
  }, [task.id, loading, onClose]);

  const handleAddressFeedback = useCallback(async () => {
    if (loading || prTabState.type !== "feedback_selected") return;
    setLoading(true);
    try {
      await invoke("workflow_address_pr_feedback", {
        taskId: task.id,
        comments: prTabState.comments,
        checks: prTabState.checks,
        guidance: prTabState.guidance || null,
      });
      onClose();
    } catch (err) {
      console.error("Failed to address PR feedback:", err);
      setLoading(false);
    }
  }, [task.id, loading, prTabState, onClose]);

  const handleSubmitAnswers = useCallback(
    async (qs: WorkflowQuestion[]) => {
      if (loading || !allAnswered) return;
      setLoading(true);
      try {
        const now = new Date().toISOString();
        await invoke("workflow_answer_questions", {
          taskId: task.id,
          answers: qs.map((q, i) => {
            const raw = answers[i];
            const optIdx = parseOptionIndex(raw);
            let answer: string;
            if (optIdx !== null) {
              // Sentinel key — resolve to the option label. If the label is
              // missing (stale state mismatch), send an empty string rather
              // than propagating the internal sentinel string to the backend.
              answer = q.options?.[optIdx]?.label ?? "";
            } else {
              answer = raw.trim();
            }
            return { question: q.question, answer, answered_at: now };
          }),
        });
        onClose();
      } catch (err) {
        console.error("Failed to submit answers:", err);
        setLoading(false);
      }
    },
    [task.id, answers, allAnswered, loading, onClose],
  );

  const handleRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await invoke("workflow_retry", {
        taskId: task.id,
        instructions: retryInstructions.trim() || null,
      });
      onClose();
    } catch (err) {
      console.error("Failed to retry:", err);
      setRetrying(false);
    }
  }, [task.id, retryInstructions, retrying, onClose]);

  const handleRequestUpdate = useCallback(async () => {
    if (loading || !updateNotes.trim()) return;
    setLoading(true);
    try {
      await invoke("workflow_request_update", { taskId: task.id, feedback: updateNotes.trim() });
      onClose();
    } catch (err) {
      console.error("Failed to request update:", err);
      setLoading(false);
    }
  }, [task.id, updateNotes, loading, onClose]);

  const [optimisticAutoMode, setOptimisticAutoMode] = useState<boolean | null>(null);

  // Clear the optimistic override once the backend value catches up.
  useEffect(() => {
    if (optimisticAutoMode !== null && task.auto_mode === optimisticAutoMode) {
      setOptimisticAutoMode(null);
    }
  }, [task.auto_mode, optimisticAutoMode]);

  const handleToggleAutoMode = useCallback(async () => {
    const newValue = !(optimisticAutoMode ?? task.auto_mode);
    setOptimisticAutoMode(newValue);
    try {
      await invoke("workflow_set_auto_mode", { taskId: task.id, autoMode: newValue });
    } catch (err) {
      console.error("Failed to set auto mode:", err);
      setOptimisticAutoMode(null);
    }
  }, [task.id, task.auto_mode, optimisticAutoMode]);

  return {
    answers,
    setAnswer,
    answeredCount,
    allAnswered,
    rejectMode,
    enterRejectMode,
    exitRejectMode,
    feedback,
    setFeedback,
    updateMode,
    enterUpdateMode,
    exitUpdateMode,
    updateNotes,
    setUpdateNotes,
    updateNotesRef,
    handleRequestUpdate,
    resumeMessage,
    setResumeMessage,
    resumeTextareaRef,
    retryInstructions,
    setRetryInstructions,
    retryTextareaRef,
    retrying,
    handleRetry,
    loading,
    interrupting,
    resuming,
    prTabState,
    setPrTabState,
    pushPullError,
    draftComments,
    lineCommentGuidance,
    setLineCommentGuidance,
    lineCommentError,
    addDraftComment,
    removeDraftComment,
    clearDraftComments,
    submitLineComments,
    feedbackRef,
    submitRef,
    handleApprove,
    handleReject,
    handleInterrupt,
    handleResume,
    handleMerge,
    handleOpenPr,
    handleArchive,
    handleFixConflicts,
    handleAddressFeedback,
    handlePushPr,
    handlePullPr,
    handleSubmitAnswers,
    handleToggleAutoMode,
    optimisticAutoMode,
  };
}
