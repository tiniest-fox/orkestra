/**
 * Hook for managing question form state.
 * Handles multi-step question navigation, "Other" option selection, and answer collection.
 *
 * Questions and options are identified by position (array index), not IDs.
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
  /** Selected answers keyed by question index. */
  answers: Record<number, string>;
  /** Whether "Other" is selected for each question (keyed by index). */
  otherSelected: Record<number, boolean>;
  /** Custom text for "Other" responses (keyed by index). */
  otherText: Record<number, string>;
  /** Handle selecting an option (stores the option label as the answer). */
  selectOption: (questionIndex: number, optionLabel: string) => void;
  /** Handle selecting "Other". */
  selectOther: (questionIndex: number) => void;
  /** Handle updating "Other" text. */
  updateOtherText: (questionIndex: number, text: string) => void;
  /** Navigate to previous question. */
  goToPrevious: () => void;
  /** Navigate to next question. */
  goToNext: () => void;
  /** Get formatted answers for submission. */
  getFormattedAnswers: () => WorkflowQuestionAnswer[];
}

export function useQuestionForm(questions: WorkflowQuestion[]): UseQuestionFormResult {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [otherSelected, setOtherSelected] = useState<Record<number, boolean>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});

  // Reset current index when questions change
  const questionsKey = `${questions.length}-${questions[0]?.question ?? "none"}`;
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
    (otherSelected[currentIndex]
      ? Boolean(otherText[currentIndex]?.trim())
      : Boolean(answers[currentIndex]?.trim()));

  // Check if all questions are answered
  const allAnswered = questions.every((_, i) => {
    if (otherSelected[i]) {
      return Boolean(otherText[i]?.trim());
    }
    return Boolean(answers[i]?.trim());
  });

  const selectOption = (questionIndex: number, optionLabel: string) => {
    setAnswers((prev) => ({ ...prev, [questionIndex]: optionLabel }));
    setOtherSelected((prev) => ({ ...prev, [questionIndex]: false }));
  };

  const selectOther = (questionIndex: number) => {
    setOtherSelected((prev) => ({ ...prev, [questionIndex]: true }));
    setAnswers((prev) => ({ ...prev, [questionIndex]: "" }));
  };

  const updateOtherText = (questionIndex: number, text: string) => {
    setOtherText((prev) => ({ ...prev, [questionIndex]: text }));
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
    return questions.map((q, i) => ({
      question: q.question,
      answer: otherSelected[i] ? otherText[i] || "" : answers[i] || "",
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
