/**
 * Question form panel - multi-step question answering interface.
 */

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

  const handleSubmit = () => {
    onSubmit(getFormattedAnswers());
  };

  if (!currentQuestion) return null;

  return (
    <Panel accent="info" autoFill={false} className="m-2 mt-0">
      <div className="p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-info">Questions</div>
          <div className="text-xs text-info/70">
            Question {currentIndex + 1} of {questions.length}
          </div>
        </div>

        <div className="overflow-auto max-h-[300px] mb-4">
          <div className="text-sm font-medium text-stone-800 mb-1">{currentQuestion.question}</div>
          {currentQuestion.context && (
            <div className="text-xs text-stone-500 mb-2">{currentQuestion.context}</div>
          )}
          <div className="space-y-1">
            {currentQuestion.options?.map((option) => (
              <label key={option.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={currentQuestion.id}
                  value={option.id}
                  checked={
                    answers[currentQuestion.id] === option.id && !otherSelected[currentQuestion.id]
                  }
                  onChange={() => selectOption(currentQuestion.id, option.id)}
                  className="text-info mt-0.5 accent-info"
                />
                <div>
                  <span className="text-sm text-stone-700">{option.label}</span>
                  {option.description && (
                    <span className="text-xs text-stone-500 ml-1">- {option.description}</span>
                  )}
                </div>
              </label>
            ))}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name={currentQuestion.id}
                value="__other__"
                checked={otherSelected[currentQuestion.id] === true}
                onChange={() => selectOther(currentQuestion.id)}
                className="text-info mt-0.5 accent-info"
              />
              <div>
                <span className="text-sm text-stone-700">Other (custom response)</span>
              </div>
            </label>
            {otherSelected[currentQuestion.id] && (
              <textarea
                value={otherText[currentQuestion.id] || ""}
                onChange={(e) => updateOtherText(currentQuestion.id, e.target.value)}
                placeholder="Type your custom response..."
                className="w-full mt-2 px-3 py-2 text-sm border border-stone-300 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-info resize-none text-stone-800"
                rows={2}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPrevious}
            disabled={isFirstQuestion || isSubmitting}
            className="text-info hover:bg-blue-100"
          >
            Previous
          </Button>

          {isLastQuestion ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !allAnswered}
              loading={isSubmitting}
              className="bg-info hover:bg-blue-600"
            >
              Submit Answers
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={goToNext}
              disabled={!currentAnswered || isSubmitting}
              className="bg-info hover:bg-blue-600"
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
