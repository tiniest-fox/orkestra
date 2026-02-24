//! Footer for the questions state — submit answers when all are filled in.

import type React from "react";
import type { WorkflowQuestion } from "../../../../types/workflow";
import { Button } from "../../../ui/Button";
import { FooterBar } from "./FooterBar";

interface QuestionsFooterProps {
  questions: WorkflowQuestion[];
  answeredCount: number;
  allAnswered: boolean;
  loading: boolean;
  onSubmitAnswers: (questions: WorkflowQuestion[]) => void;
  submitRef: React.RefObject<HTMLButtonElement>;
}

export function QuestionsFooter({
  questions,
  answeredCount,
  allAnswered,
  loading,
  onSubmitAnswers,
  submitRef,
}: QuestionsFooterProps) {
  return (
    <FooterBar>
      <Button
        ref={submitRef}
        hotkey="s"
        onAccent
        variant="submit"
        onClick={() => onSubmitAnswers(questions)}
        disabled={!allAnswered || loading}
      >
        Submit {questions.length === 1 ? "answer" : "answers"}
      </Button>
      {questions.length > 1 && (
        <span className="ml-auto font-mono text-[11px] text-text-quaternary">
          {answeredCount} of {questions.length} answered
        </span>
      )}
    </FooterBar>
  );
}
