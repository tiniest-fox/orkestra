/**
 * Question form panel - multi-step question answering interface.
 */

import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuestionForm } from "../../hooks/useQuestionForm";
import type { WorkflowQuestion, WorkflowQuestionAnswer } from "../../types/workflow";
import { Button, Panel } from "../ui";

interface QuestionFormPanelProps {
  questions: WorkflowQuestion[];
  onSubmit: (answers: WorkflowQuestionAnswer[]) => void;
  isSubmitting: boolean;
}

export function QuestionFormPanel({ questions, onSubmit, isSubmitting }: QuestionFormPanelProps) {
  const {
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
  } = useQuestionForm(questions);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSelectOther = (questionId: string) => {
    selectOther(questionId);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const scrollToBottom = () => {
    scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight });
  };

  const handleSubmit = () => {
    onSubmit(getFormattedAnswers());
  };

  if (!currentQuestion) return null;

  return (
    <Panel accent="info" autoFill={false}>
      <div className="flex flex-col items-stretch">
        <div className="flex items-center justify-between bg-info-500 text-white mt-1 mx-1 rounded-panel px-3 py-1">
          <div className="text-sm font-medium">Questions</div>
          <div className="text-xs">
            Question {currentIndex + 1} of {questions.length}
          </div>
        </div>

        <div ref={scrollContainerRef} className="overflow-y-auto max-h-[320px] p-4">
          <div className="text-sm font-medium text-stone-800 mb-1">{currentQuestion.question}</div>
          {currentQuestion.context && <div className="text-xs text-stone-500 mb-2">{currentQuestion.context}</div>}
          <div className="space-y-1">
            {currentQuestion.options?.map((option) => {
              const isChecked = answers[currentQuestion.id] === option.id && !otherSelected[currentQuestion.id];
              const inputId = `${currentQuestion.id}-${option.id}`;
              return (
                <div key={option.id} className="flex items-start">
                  <input
                    type="radio"
                    id={inputId}
                    name={currentQuestion.id}
                    value={option.id}
                    checked={isChecked}
                    onChange={() => selectOption(currentQuestion.id, option.id)}
                    className="sr-only"
                  />
                  <label htmlFor={inputId} className="flex items-start gap-2 mb-2 cursor-pointer">
                    <span
                      className={`mt-1 flex-shrink-0 size-3.5 rounded-full border-2 flex items-center justify-center ${
                        isChecked ? "border-info-500 bg-info-500" : "border-stone-400"
                      }`}
                    >
                      {isChecked && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="text-xs">
                      <span className="text-stone-700 text-sm">{option.label}</span>
                      {option.description && (
                        <span className="text-xs text-stone-500 ml-1">- {option.description}</span>
                      )}
                    </span>
                  </label>
                </div>
              );
            })}
            {(() => {
              const isOtherChecked = otherSelected[currentQuestion.id] === true;
              const otherId = `${currentQuestion.id}-other`;
              return (
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    id={otherId}
                    name={currentQuestion.id}
                    value="__other__"
                    checked={isOtherChecked}
                    onChange={() => handleSelectOther(currentQuestion.id)}
                    className="sr-only"
                  />
                  <label htmlFor={otherId} className="flex items-start gap-2 cursor-pointer">
                    <span
                      className={`mt-1 flex-shrink-0 size-3.5 rounded-full border-2 flex items-center justify-center ${
                        isOtherChecked ? "border-info-500 bg-info-500" : "border-stone-400"
                      }`}
                    >
                      {isOtherChecked && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="text-sm text-stone-700">Other (custom response)</span>
                  </label>
                </div>
              );
            })()}
            <AnimatePresence initial={false}>
              {otherSelected[currentQuestion.id] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  onUpdate={scrollToBottom}
                  className="overflow-hidden p-0.5 -m-0.5"
                >
                  <textarea
                    ref={textareaRef}
                    value={otherText[currentQuestion.id] || ""}
                    onChange={(e) => updateOtherText(currentQuestion.id, e.target.value)}
                    placeholder="Type your custom response..."
                    className="w-full mt-2 px-3 py-2 text-sm border border-stone-300 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-info-500 resize-none text-stone-800"
                    rows={2}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex items-center justify-between bg-info-200 mx-1 mb-1 rounded-panel px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPrevious}
            disabled={isFirstQuestion || isSubmitting}
            className="text-info-600 hover:bg-info-100"
          >
            Previous
          </Button>

          {isLastQuestion ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !allAnswered}
              loading={isSubmitting}
              className="bg-info-500 hover:bg-info-600"
            >
              Submit Answers
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={goToNext}
              disabled={!currentAnswered || isSubmitting}
              className="bg-info-500 hover:bg-info-600"
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
