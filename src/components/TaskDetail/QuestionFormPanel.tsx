/**
 * Question form panel - multi-step question answering interface.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useRef } from "react";
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

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0 });
  };

  const handleGoToNext = () => {
    goToNext();
    scrollToTop();
  };

  const handleGoToPrevious = () => {
    goToPrevious();
    scrollToTop();
  };

  const handleSelectOther = (questionIndex: number) => {
    selectOther(questionIndex);
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
    <Panel accent="info" autoFill={false} className="h-[320px]">
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between bg-info-500 text-white mt-1 mx-1 rounded-panel px-3 py-1">
          <div className="text-sm font-medium">Questions</div>
          <div className="text-xs">
            Question {currentIndex + 1} of {questions.length}
          </div>
        </div>

        <div
          key={currentIndex}
          ref={scrollContainerRef}
          className="overflow-y-auto max-h-[320px] p-4"
        >
          <div className="text-sm font-medium text-stone-800 dark:text-stone-100 mb-1">
            {currentQuestion.question}
          </div>
          {currentQuestion.context && (
            <div className="text-xs text-stone-500 dark:text-stone-400 mb-2">
              {currentQuestion.context}
            </div>
          )}
          <div className="space-y-1">
            {currentQuestion.options?.map((option, optionIndex) => {
              const isChecked =
                answers[currentIndex] === option.label && !otherSelected[currentIndex];
              const inputId = `q${currentIndex}-opt${optionIndex}`;
              return (
                <div key={option.label} className="flex items-start">
                  <input
                    type="radio"
                    id={inputId}
                    name={`question-${currentIndex}`}
                    value={option.label}
                    checked={isChecked}
                    onChange={() => selectOption(currentIndex, option.label)}
                    className="sr-only"
                  />
                  <label htmlFor={inputId} className="flex items-start gap-2 mb-2 cursor-pointer">
                    <span
                      className={`mt-1 flex-shrink-0 size-3.5 rounded-full border-2 flex items-center justify-center ${
                        isChecked
                          ? "border-info-500 bg-info-500"
                          : "border-stone-400 dark:border-stone-500"
                      }`}
                    >
                      {isChecked && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="text-xs">
                      <span className="text-stone-700 dark:text-stone-200 text-sm">
                        {option.label}
                      </span>
                      {option.description && (
                        <span className="text-xs text-stone-500 dark:text-stone-400 ml-1">
                          - {option.description}
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              );
            })}
            {(() => {
              const isOtherChecked = otherSelected[currentIndex] === true;
              const otherId = `q${currentIndex}-other`;
              return (
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    id={otherId}
                    name={`question-${currentIndex}`}
                    value="__other__"
                    checked={isOtherChecked}
                    onChange={() => handleSelectOther(currentIndex)}
                    className="sr-only"
                  />
                  <label htmlFor={otherId} className="flex items-start gap-2 cursor-pointer">
                    <span
                      className={`mt-1 flex-shrink-0 size-3.5 rounded-full border-2 flex items-center justify-center ${
                        isOtherChecked
                          ? "border-info-500 bg-info-500"
                          : "border-stone-400 dark:border-stone-500"
                      }`}
                    >
                      {isOtherChecked && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="text-sm text-stone-700 dark:text-stone-200">
                      Other (custom response)
                    </span>
                  </label>
                </div>
              );
            })()}
            <AnimatePresence initial={false}>
              {otherSelected[currentIndex] && (
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
                    value={otherText[currentIndex] || ""}
                    onChange={(e) => updateOtherText(currentIndex, e.target.value)}
                    placeholder="Type your custom response..."
                    className="w-full mt-2 px-3 py-2 text-sm border border-stone-300 dark:bg-stone-800 dark:border-stone-600 dark:text-stone-100 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-info-500 resize-none text-stone-800"
                    rows={2}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex items-center justify-between bg-info-200 dark:bg-info-800 mx-1 mb-1 rounded-panel px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoToPrevious}
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
              onClick={handleGoToNext}
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
