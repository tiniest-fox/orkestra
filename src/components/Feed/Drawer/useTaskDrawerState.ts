//! State management and action handlers for the TaskDrawer component.

import { useCallback, useEffect, useRef, useState } from "react";
import { parseOptionIndex } from "../../../lib/optionKey";
import { useTasks } from "../../../providers/TasksProvider";
import { useTransport } from "../../../transport";
import type { WorkflowQuestion, WorkflowTaskView } from "../../../types/workflow";
import { confirmAction } from "../../../utils/confirmAction";
import { extractErrorMessage } from "../../../utils/errors";
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

  // -- Update mode (done tasks) --
  updateMode: boolean;
  enterUpdateMode: () => void;
  exitUpdateMode: () => void;
  updateNotes: string;
  setUpdateNotes: (v: string) => void;
  updateNotesRef: React.RefObject<HTMLTextAreaElement>;
  handleRequestUpdate: () => Promise<void>;

  // -- Loading state --
  loading: boolean;
  interrupting: boolean;

  // -- PR tab state --
  prTabState: PrTabFooterState;
  setPrTabState: (state: PrTabFooterState) => void;

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

  // -- Message compose --
  message: string;
  setMessage: (v: string) => void;
  messageTextareaRef: React.RefObject<HTMLTextAreaElement>;
  messageSending: boolean;
  messageError: string | null;
  handleSendMessage: () => Promise<void>;

  // -- Refs --
  submitRef: React.RefObject<HTMLButtonElement>;

  // -- Action handlers --
  handleApprove: () => Promise<void>;
  handleInterrupt: () => Promise<void>;
  handleMerge: () => Promise<void>;
  handleOpenPr: () => Promise<void>;
  handleArchive: () => Promise<void>;
  handleFixConflicts: () => Promise<void>;
  handleAddressFeedback: () => Promise<void>;
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
  const transport = useTransport();
  const { applyOptimistic } = useTasks();
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

  // -- Submit button ref for questions --
  const submitRef = useRef<HTMLButtonElement>(null);

  // -- Loading state --
  const [loading, setLoading] = useState(false);
  const [interrupting, setInterrupting] = useState(false);

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
      await transport.call("address_pr_feedback", {
        task_id: task.id,
        comments,
        checks: [],
        guidance,
      });
      clearDraftComments();
      onClose();
    } catch (err) {
      const message = extractErrorMessage(err);
      setLineCommentError(message);
      setLoading(false);
    }
  }, [
    transport,
    task.id,
    loading,
    draftComments,
    lineCommentGuidance,
    clearDraftComments,
    onClose,
  ]);

  const submitLineCommentsForReview = useCallback(async () => {
    if (loading || draftComments.length === 0) return;
    setLineCommentError(null);
    setLoading(true);
    try {
      const comments = mapDraftsToPrComments(draftComments);
      const guidance = lineCommentGuidance.trim() || null;
      await transport.call("reject_with_comments", { task_id: task.id, comments, guidance });
      clearDraftComments();
      onClose();
    } catch (err) {
      const message = extractErrorMessage(err);
      setLineCommentError(message);
      setLoading(false);
    }
  }, [
    transport,
    task.id,
    loading,
    draftComments,
    lineCommentGuidance,
    clearDraftComments,
    onClose,
  ]);

  const submitLineComments = task.derived.is_done
    ? submitLineCommentsForDoneTask
    : submitLineCommentsForReview;

  // -- Message compose --
  const [message, setMessage] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset message state when task changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setMessage("");
    setMessageSending(false);
    setMessageError(null);
  }, [task.id]);

  const handleSendMessage = useCallback(async () => {
    if (!message.trim() || messageSending) return;
    setMessageSending(true);
    setMessageError(null);
    try {
      await transport.call("send_message", { task_id: task.id, message: message.trim() });
      setMessage("");
    } catch (err) {
      const msg = extractErrorMessage(err);
      setMessageError(msg);
    } finally {
      setMessageSending(false);
    }
  }, [transport, task.id, message, messageSending]);

  // -- Action handlers --

  const callAndClose = useCallback(
    async (method: string, args: Record<string, unknown> = {}) => {
      if (loading) return;
      setLoading(true);
      try {
        await transport.call(method, { task_id: task.id, ...args });
        onClose();
      } catch (err) {
        console.error(`Failed to ${method}:`, err);
        setLoading(false);
      }
    },
    [transport, task.id, loading, onClose],
  );

  const handleApprove = useCallback(() => {
    applyOptimistic(task.id, { type: "approve" });
    return callAndClose("approve");
  }, [callAndClose, applyOptimistic, task.id]);

  const handleInterrupt = useCallback(async () => {
    if (interrupting) return;
    applyOptimistic(task.id, { type: "interrupt" });
    setInterrupting(true);
    try {
      await transport.call("interrupt", { task_id: task.id });
    } catch (err) {
      console.error("Failed to interrupt:", err);
    } finally {
      setInterrupting(false);
    }
  }, [transport, task.id, interrupting, applyOptimistic]);

  const handleMerge = useCallback(() => callAndClose("merge_task"), [callAndClose]);

  const handleOpenPr = useCallback(() => callAndClose("open_pr"), [callAndClose]);

  const handleArchive = useCallback(async () => {
    if (!(await confirmAction("Archive this Trak?"))) return;
    applyOptimistic(task.id, { type: "archive" });
    return callAndClose("archive");
  }, [callAndClose, applyOptimistic, task.id]);

  const handleFixConflicts = useCallback(
    () =>
      callAndClose("address_pr_conflicts", {
        base_branch: `origin/${task.base_branch}`,
      }),
    [callAndClose, task.base_branch],
  );

  const handleAddressFeedback = useCallback(async () => {
    if (loading || prTabState.type !== "feedback_selected") return;
    setLoading(true);
    try {
      await transport.call("address_pr_feedback", {
        task_id: task.id,
        comments: prTabState.comments,
        checks: prTabState.checks,
        guidance: prTabState.guidance || null,
      });
      onClose();
    } catch (err) {
      console.error("Failed to address PR feedback:", err);
      setLoading(false);
    }
  }, [transport, task.id, loading, prTabState, onClose]);

  const handleSubmitAnswers = useCallback(
    async (qs: WorkflowQuestion[]) => {
      if (loading || !allAnswered) return;
      applyOptimistic(task.id, { type: "answer_questions" });
      setLoading(true);
      try {
        const now = new Date().toISOString();
        await transport.call("answer_questions", {
          task_id: task.id,
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
    [transport, task.id, answers, allAnswered, loading, onClose, applyOptimistic],
  );

  const handleRequestUpdate = useCallback(async () => {
    if (loading || !updateNotes.trim()) return;
    setLoading(true);
    try {
      await transport.call("request_update", {
        task_id: task.id,
        feedback: updateNotes.trim(),
      });
      onClose();
    } catch (err) {
      console.error("Failed to request update:", err);
      setLoading(false);
    }
  }, [transport, task.id, updateNotes, loading, onClose]);

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
      await transport.call("set_auto_mode", { task_id: task.id, auto_mode: newValue });
    } catch (err) {
      console.error("Failed to set auto mode:", err);
      setOptimisticAutoMode(null);
    }
  }, [transport, task.id, task.auto_mode, optimisticAutoMode]);

  return {
    answers,
    setAnswer,
    answeredCount,
    allAnswered,
    updateMode,
    enterUpdateMode,
    exitUpdateMode,
    updateNotes,
    setUpdateNotes,
    updateNotesRef,
    handleRequestUpdate,
    loading,
    interrupting,
    prTabState,
    setPrTabState,
    draftComments,
    lineCommentGuidance,
    setLineCommentGuidance,
    lineCommentError,
    addDraftComment,
    removeDraftComment,
    clearDraftComments,
    submitLineComments,
    message,
    setMessage,
    messageTextareaRef,
    messageSending,
    messageError,
    handleSendMessage,
    submitRef,
    handleApprove,
    handleInterrupt,
    handleMerge,
    handleOpenPr,
    handleArchive,
    handleFixConflicts,
    handleAddressFeedback,
    handleSubmitAnswers,
    handleToggleAutoMode,
    optimisticAutoMode,
  };
}
