//! State management and action handlers for the TaskDrawer component.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowQuestion, WorkflowTaskView } from "../../../types/workflow";
import type { PrTabFooterState } from "./drawerTabs";

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

  // -- Resume (interrupted) --
  resumeMessage: string;
  setResumeMessage: (v: string) => void;
  resumeTextareaRef: React.RefObject<HTMLTextAreaElement>;

  // -- Loading state --
  loading: boolean;
  interrupting: boolean;
  resuming: boolean;

  // -- PR tab state --
  prTabState: PrTabFooterState;
  setPrTabState: (state: PrTabFooterState) => void;

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
  handleAddressComments: () => Promise<void>;
  handleSubmitAnswers: (questions: WorkflowQuestion[]) => Promise<void>;
  handleToggleAutoMode: () => Promise<void>;
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

  // -- Resume message --
  const [resumeMessage, setResumeMessage] = useState("");
  const resumeTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (task.derived.is_interrupted) resumeTextareaRef.current?.focus();
  }, [task.derived.is_interrupted]);

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

  const handleSubmitAnswers = useCallback(
    async (qs: WorkflowQuestion[]) => {
      if (loading || !allAnswered) return;
      setLoading(true);
      try {
        const now = new Date().toISOString();
        await invoke("workflow_answer_questions", {
          taskId: task.id,
          answers: qs.map((q, i) => ({
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
    },
    [task.id, answers, allAnswered, loading, onClose],
  );

  const handleToggleAutoMode = useCallback(async () => {
    await invoke("workflow_set_auto_mode", { taskId: task.id, autoMode: !task.auto_mode });
  }, [task.id, task.auto_mode]);

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
    resumeMessage,
    setResumeMessage,
    resumeTextareaRef,
    loading,
    interrupting,
    resuming,
    prTabState,
    setPrTabState,
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
    handleAddressComments,
    handleSubmitAnswers,
    handleToggleAutoMode,
  };
}
