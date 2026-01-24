import { useEffect, useState } from "react";
import type { PlannerQuestion, QuestionAnswer } from "../types/task";

interface QuestionFormProps {
  questions: PlannerQuestion[];
  onSubmit: (answers: QuestionAnswer[]) => void;
  isSubmitting: boolean;
}

interface QuestionCardProps {
  question: PlannerQuestion;
  selectedAnswer: string;
  customAnswer: string;
  onSelectOption: (label: string) => void;
  onCustomChange: (value: string) => void;
}

function QuestionCard({
  question,
  selectedAnswer,
  customAnswer,
  onSelectOption,
  onCustomChange,
}: QuestionCardProps) {
  const isCustomSelected = selectedAnswer === "__custom__";

  return (
    <div className="border border-purple-200 rounded-lg p-4 bg-white">
      <h4 className="font-medium text-gray-900 mb-2">{question.question}</h4>
      {question.context && (
        <p className="text-sm text-gray-600 mb-3 bg-gray-50 p-2 rounded">{question.context}</p>
      )}
      <div className="space-y-2">
        {question.options.map((option) => (
          <label
            key={option.label}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selectedAnswer === option.label
                ? "border-purple-500 bg-purple-50"
                : "border-gray-200 hover:border-purple-300 hover:bg-purple-50/50"
            }`}
          >
            <input
              type="radio"
              name={`question-${question.id}`}
              value={option.label}
              checked={selectedAnswer === option.label}
              onChange={() => onSelectOption(option.label)}
              className="mt-1 text-purple-600 focus:ring-purple-500"
            />
            <div>
              <div className="font-medium text-gray-900">{option.label}</div>
              {option.description && (
                <div className="text-sm text-gray-600">{option.description}</div>
              )}
            </div>
          </label>
        ))}
        {/* Custom "Other" option */}
        <label
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            isCustomSelected
              ? "border-purple-500 bg-purple-50"
              : "border-gray-200 hover:border-purple-300 hover:bg-purple-50/50"
          }`}
        >
          <input
            type="radio"
            name={`question-${question.id}`}
            value="__custom__"
            checked={isCustomSelected}
            onChange={() => onSelectOption("__custom__")}
            className="mt-1 text-purple-600 focus:ring-purple-500"
          />
          <div className="flex-1">
            <div className="font-medium text-gray-900">Other</div>
            {isCustomSelected && (
              <textarea
                value={customAnswer}
                onChange={(e) => onCustomChange(e.target.value)}
                placeholder="Enter your answer..."
                className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                rows={2}
                autoFocus
              />
            )}
          </div>
        </label>
      </div>
    </div>
  );
}

export function QuestionForm({ questions, onSubmit, isSubmitting }: QuestionFormProps) {
  // Track selected answers and custom text for each question
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  // Reset form state when questions change (e.g., switching tasks or new questions from planner)
  useEffect(() => {
    setSelectedAnswers({});
    setCustomAnswers({});
  }, [questions]);

  const handleSelectOption = (questionId: string, label: string) => {
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: label }));
  };

  const handleCustomChange = (questionId: string, value: string) => {
    setCustomAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  // Get the answer for a question, handling custom answers
  const getAnswer = (questionId: string): string => {
    const selected = selectedAnswers[questionId];
    if (!selected) return "";
    if (selected === "__custom__") {
      return (customAnswers[questionId] || "").trim();
    }
    return selected;
  };

  const handleSubmit = () => {
    // Double-check all answers are valid before submitting
    if (!allAnswered) return;

    const answers: QuestionAnswer[] = questions.map((q) => ({
      question: q,
      answer: getAnswer(q.id),
    }));
    onSubmit(answers);
  };

  // Check if all questions have been answered with non-empty values
  const allAnswered = questions.every((q) => {
    const answer = getAnswer(q.id);
    return answer.length > 0;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-purple-700">
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="font-medium">Questions from Planner</span>
      </div>
      <p className="text-sm text-gray-600">
        The planner needs more information before creating an implementation plan. Please answer the
        following questions:
      </p>

      {questions.map((question) => (
        <QuestionCard
          key={question.id}
          question={question}
          selectedAnswer={selectedAnswers[question.id] || ""}
          customAnswer={customAnswers[question.id] || ""}
          onSelectOption={(label) => handleSelectOption(question.id, label)}
          onCustomChange={(value) => handleCustomChange(question.id, value)}
        />
      ))}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!allAnswered || isSubmitting}
        className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? "Submitting..." : "Submit Answers"}
      </button>
    </div>
  );
}
