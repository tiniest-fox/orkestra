/**
 * Hook for managing question form state.
 * Handles multi-step question navigation, "Other" option selection, and answer collection.
 */

import { useEffect, useState } from "react";
import type { WorkflowQuestion, WorkflowQuestionAnswer } from "../types/workflow";

interface UseQuestionFormResult {
  /** Current question index (0-based). */
  currentIndex: number;
  /** Current question being displayed. */
  currentQuestion: WorkflowQuestion | undefined;
  /** Whether we're on the first question. */
  isFirstQuestion: boolean;
  /** Whether we're on the last question. */
  isLastQuestion: boolean;
  /** Whether the current question has been answered. */
  currentAnswered: boolean;
  /** Whether all questions have been answered. */
  allAnswered: boolean;
  /** Selected answers keyed by question ID. */
  answers: Record<string, string>;
  /** Whether "Other" is selected for each question. */
  otherSelected: Record<string, boolean>;
  /** Custom text for "Other" responses. */
  otherText: Record<string, string>;
  /** Handle selecting an option. */
  selectOption: (questionId: string, optionId: string) => void;
  /** Handle selecting "Other". */
  selectOther: (questionId: string) => void;
  /** Handle updating "Other" text. */
  updateOtherText: (questionId: string, text: string) => void;
  /** Navigate to previous question. */
  goToPrevious: () => void;
  /** Navigate to next question. */
  goToNext: () => void;
  /** Get formatted answers for submission. */
  getFormattedAnswers: () => WorkflowQuestionAnswer[];
}

export function useQuestionForm(questions: WorkflowQuestion[]): UseQuestionFormResult {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  // Reset current index when questions change
  const questionsKey = `${questions.length}-${questions[0]?.id ?? "none"}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when questionsKey changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [questionsKey]);

  const currentQuestion = questions[currentIndex];
  const isFirstQuestion = currentIndex === 0;
  const isLastQuestion = currentIndex === questions.length - 1;

  // Check if current question is answered
  const currentAnswered =
    currentQuestion !== undefined &&
    (otherSelected[currentQuestion.id]
      ? Boolean(otherText[currentQuestion.id]?.trim())
      : Boolean(answers[currentQuestion.id]?.trim()));

  // Check if all questions are answered
  const allAnswered = questions.every((q) => {
    if (otherSelected[q.id]) {
      return Boolean(otherText[q.id]?.trim());
    }
    return Boolean(answers[q.id]?.trim());
  });

  const selectOption = (questionId: string, optionId: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setOtherSelected((prev) => ({ ...prev, [questionId]: false }));
  };

  const selectOther = (questionId: string) => {
    setOtherSelected((prev) => ({ ...prev, [questionId]: true }));
    setAnswers((prev) => ({ ...prev, [questionId]: "" }));
  };

  const updateOtherText = (questionId: string, text: string) => {
    setOtherText((prev) => ({ ...prev, [questionId]: text }));
  };

  const goToPrevious = () => {
    if (!isFirstQuestion) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const goToNext = () => {
    if (!isLastQuestion) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const getFormattedAnswers = (): WorkflowQuestionAnswer[] => {
    return questions.map((q) => ({
      question_id: q.id,
      question: q.question,
      answer: otherSelected[q.id] ? otherText[q.id] || "" : answers[q.id] || "",
      answered_at: new Date().toISOString(),
    }));
  };

  return {
    currentIndex,
    currentQuestion,
    isFirstQuestion,
    isLastQuestion,
    currentAnswered,
    allAnswered,
    answers,
    otherSelected,
    otherText,
    selectOption,
    selectOther,
    updateOtherText,
    goToPrevious,
    goToNext,
    getFormattedAnswers,
  };
}
