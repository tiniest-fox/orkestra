// Inline questions form rendered in the agent timeline — reuses QuestionCard with inline scroll context.

import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isOptionKey, optionKey } from "../../../../lib/optionKey";
import type { WorkflowQuestion, WorkflowTaskView } from "../../../../types/workflow";
import { Button } from "../../../ui/Button";
import { useNavHandler } from "../../../ui/HotkeyScope";
import { NavigationScope } from "../../../ui/NavigationScope";
import { QuestionCard } from "../../QuestionCard";

// ============================================================================
// Types
// ============================================================================

type FlatItem =
  | { type: "option"; qIdx: number; optIdx: number }
  | { type: "textarea"; qIdx: number };

interface InlineQuestionsCardProps {
  task: WorkflowTaskView;
  questions: WorkflowQuestion[];
  answers: string[];
  setAnswer: (index: number, value: string) => void;
  onSubmitAnswers: (questions: WorkflowQuestion[]) => void;
  loading: boolean;
  submitRef: React.RefObject<HTMLButtonElement>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  answeredCount: number;
  allAnswered: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function InlineQuestionsCard({
  task,
  questions,
  answers,
  setAnswer,
  onSubmitAnswers,
  loading,
  submitRef,
  scrollContainerRef,
  answeredCount,
  allAnswered,
}: InlineQuestionsCardProps) {
  const [flatIdx, setFlatIdx] = useState(0);
  const [scrollSeq, setScrollSeq] = useState(0);
  const [cursorTarget, setCursorTarget] = useState<{ qIdx: number; char: string } | null>(null);
  const textareaRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on task id change
  useEffect(() => {
    setFlatIdx(0);
    setScrollSeq(0);
    setCursorTarget(null);
    textareaRefs.current.clear();
  }, [task.id]);

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      if (q.options && q.options.length > 0) {
        for (let oi = 0; oi < q.options.length; oi++) {
          items.push({ type: "option", qIdx: qi, optIdx: oi });
        }
      }
      items.push({ type: "textarea", qIdx: qi });
    }
    return items;
  }, [questions]);

  const questionFlatStart = useMemo(() => {
    const starts: number[] = [];
    let count = 0;
    for (let qi = 0; qi < questions.length; qi++) {
      starts.push(count);
      const q = questions[qi];
      count += (q.options?.length ?? 0) + 1;
    }
    return starts;
  }, [questions]);

  const onFocusSubmit = useCallback(() => {
    submitRef.current?.focus();
  }, [submitRef]);

  const advanceFromQuestion = useCallback(
    (qi: number) => {
      if (qi + 1 < questions.length) {
        setFlatIdx(questionFlatStart[qi + 1]);
        setScrollSeq((n) => n + 1);
      } else {
        onFocusSubmit();
      }
    },
    [questions, questionFlatStart, onFocusSubmit],
  );

  const handleSetAnswer = useCallback(
    (index: number, value: string) => {
      setAnswer(index, value);
      const isOptionSelected = isOptionKey(value);
      if (isOptionSelected) {
        setTimeout(() => advanceFromQuestion(index), 320);
      }
    },
    [setAnswer, advanceFromQuestion],
  );

  useLayoutEffect(() => {
    if (!cursorTarget) return;
    const el = textareaRefs.current.get(cursorTarget.qIdx);
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    setCursorTarget(null);
  }, [cursorTarget]);

  function textareaHasFocus() {
    return document.activeElement instanceof HTMLTextAreaElement;
  }

  useNavHandler("ArrowDown", () => {
    if (textareaHasFocus()) return;
    setFlatIdx((i) => Math.min(i + 1, flatItems.length - 1));
    setScrollSeq((n) => n + 1);
  });
  useNavHandler("ArrowUp", () => {
    if (textareaHasFocus()) return;
    setFlatIdx((i) => Math.max(i - 1, 0));
    setScrollSeq((n) => n + 1);
  });

  function selectFocused() {
    if (textareaHasFocus()) return;
    const item = flatItems[flatIdx];
    if (!item) return;
    if (item.type === "option") {
      const key = optionKey(item.optIdx);
      handleSetAnswer(item.qIdx, answers[item.qIdx] === key ? "" : key);
    }
  }
  useNavHandler("Enter", selectFocused);
  useNavHandler(" ", selectFocused);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handleSetAnswer and textareaHasFocus are stable via closure
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (loading) return;
      if (textareaHasFocus()) return;
      const item = flatItems[flatIdx];
      if (!item || item.type !== "textarea") return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const qi = item.qIdx;
      const prev = answers[qi] ?? "";
      const currentVal = isOptionKey(prev) ? "" : prev;
      handleSetAnswer(qi, currentVal + e.key);
      setCursorTarget({ qIdx: qi, char: e.key });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flatIdx, flatItems, answers, questions, loading]);

  const activeQuestionId = flatItems[flatIdx] ? String(flatItems[flatIdx].qIdx) : undefined;

  return (
    <div className="border-t border-border">
      <NavigationScope
        activeId={activeQuestionId}
        containerRef={scrollContainerRef}
        buffer={48}
        scrollSeq={scrollSeq}
      >
        <div className="divide-y divide-border">
          {questions.map((q, qi) => (
            <QuestionCard
              // biome-ignore lint/suspicious/noArrayIndexKey: questions lack stable IDs
              key={qi}
              index={qi}
              question={q}
              value={answers[qi] ?? ""}
              onChange={(val) => handleSetAnswer(qi, val)}
              keyboardFlatIdx={flatIdx}
              flatStartIndex={questionFlatStart[qi]}
              textareaRef={(el) => {
                if (el) textareaRefs.current.set(qi, el);
                else textareaRefs.current.delete(qi);
              }}
              onOptionClick={(optIdx) => setFlatIdx(questionFlatStart[qi] + optIdx)}
              onOptionHover={(optIdx) => {
                if (textareaHasFocus()) return;
                setFlatIdx(questionFlatStart[qi] + optIdx);
              }}
              onTextareaFocus={() => setFlatIdx(questionFlatStart[qi] + (q.options?.length ?? 0))}
              onTextareaHover={() => {
                if (textareaHasFocus()) return;
                setFlatIdx(questionFlatStart[qi] + (q.options?.length ?? 0));
              }}
              onTextareaEnter={() => {
                if ((answers[qi] ?? "").trim().length > 0) advanceFromQuestion(qi);
              }}
              onTextareaEscape={() => handleSetAnswer(qi, "")}
            />
          ))}
        </div>
      </NavigationScope>
      <div className="flex items-center gap-2.5 px-6 py-3 border-t border-border">
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
      </div>
    </div>
  );
}
