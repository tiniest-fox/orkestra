//! Individual question card — free-text and multiple-choice, with answered/unanswered
//! visual states and keyboard navigation focus ring.

import { memo, useRef } from "react";
import { isOptionKey, optionKey } from "../../lib/optionKey";
import type { WorkflowQuestion } from "../../types/workflow";
import { useNavItem } from "../ui/NavigationScope";

interface QuestionCardProps {
  index: number;
  question: WorkflowQuestion;
  value: string;
  onChange: (value: string) => void;
  /** Flat index of this question's first navigable item. */
  flatStartIndex: number;
  /** Current global flat index for keyboard navigation. */
  keyboardFlatIdx: number;
  /** Ref callback for the textarea. */
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
  /** Called when the user clicks an MC option (syncs flatIdx). */
  onOptionClick?: (optIdx: number) => void;
  /** Called when the user hovers an MC option (syncs flatIdx, may be suppressed). */
  onOptionHover?: (optIdx: number) => void;
  /** Called when the textarea receives DOM focus (syncs flatIdx). */
  onTextareaFocus?: () => void;
  /** Called on textarea mouseenter (may be suppressed when another textarea is focused). */
  onTextareaHover?: () => void;
  /** Called when Enter is pressed inside the textarea (confirm + advance). */
  onTextareaEnter?: () => void;
  /** Called when Escape is pressed inside the textarea (clear + blur). */
  onTextareaEscape?: () => void;
}

export const QuestionCard = memo(function QuestionCard({
  index,
  question,
  value,
  onChange,
  flatStartIndex,
  keyboardFlatIdx,
  textareaRef,
  onOptionClick,
  onOptionHover,
  onTextareaFocus,
  onTextareaHover,
  onTextareaEnter,
  onTextareaEscape,
}: QuestionCardProps) {
  const answered = value.trim().length > 0;
  const num = String(index + 1).padStart(2, "0");
  const cardRef = useRef<HTMLDivElement>(null);
  useNavItem(String(index), cardRef);

  function textareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onTextareaEnter?.();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onTextareaEscape?.();
      e.currentTarget.blur();
    }
  }

  return (
    <div ref={cardRef} className="py-5">
      {/* Question header */}
      <div className="flex items-start gap-3 mb-3">
        <span
          className={`font-mono text-[13px] font-semibold shrink-0 leading-snug w-5 text-center ${answered ? "text-status-success" : "text-status-info"}`}
        >
          {answered ? "✓" : num}
        </span>
        <div className="min-w-0">
          <div
            className={`font-sans text-[13px] font-medium tracking-[-0.01em] leading-snug ${answered ? "text-text-secondary" : "text-text-primary"}`}
          >
            {question.question}
          </div>
          {question.context && (
            <div className="font-mono text-[11px] text-text-tertiary mt-1 leading-relaxed">
              {question.context}
            </div>
          )}
        </div>
      </div>

      {/* Answer input */}
      <div className="ml-8">
        {question.options ? (
          <div className="flex flex-col gap-1.5">
            {question.options.map((opt, oi) => {
              const selected = value === optionKey(oi);
              const kbdFocused = flatStartIndex + oi === keyboardFlatIdx;
              return (
                <button
                  type="button"
                  key={optionKey(oi)}
                  onClick={() => {
                    onChange(selected ? "" : optionKey(oi));
                    onOptionClick?.(oi);
                  }}
                  onMouseEnter={() => onOptionHover?.(oi)}
                  className={[
                    "text-left w-full px-3 py-2 rounded-md border transition-colors outline-none",
                    selected
                      ? "bg-status-info-bg border-status-info text-status-info"
                      : "border-border text-text-secondary hover:bg-canvas",
                    answered && !selected ? "opacity-45" : "",
                    kbdFocused && !selected ? "ring-1 ring-status-info ring-offset-1" : "",
                    kbdFocused && selected ? "ring-1 ring-status-info ring-offset-1" : "",
                  ].join(" ")}
                >
                  <div className="font-sans text-[12px] font-medium leading-snug">{opt.label}</div>
                  {opt.description && (
                    <div className="font-mono text-[10px] text-text-tertiary mt-0.5">
                      {opt.description}
                    </div>
                  )}
                </button>
              );
            })}
            {/* Write-in textarea — value only when no option is selected */}
            {(() => {
              const writeInValue = isOptionKey(value) ? "" : value;
              const kbdFocused = flatStartIndex + question.options.length === keyboardFlatIdx;
              return (
                <textarea
                  ref={textareaRef}
                  value={writeInValue}
                  onChange={(e) => onChange(e.target.value)}
                  onFocus={onTextareaFocus}
                  onMouseEnter={onTextareaHover}
                  onKeyDown={textareaKeyDown}
                  placeholder="Or write your own answer…"
                  rows={2}
                  className={[
                    "w-full font-sans text-[12px] text-text-primary placeholder:text-text-quaternary bg-canvas border border-border rounded-md px-3 py-2 outline-none transition-colors resize-none leading-relaxed",
                    kbdFocused
                      ? "ring-1 ring-status-info ring-offset-1 focus:border-status-info"
                      : "focus:border-status-info",
                    answered && writeInValue.length === 0 ? "opacity-45" : "",
                  ].join(" ")}
                />
              );
            })()}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onTextareaFocus}
            onMouseEnter={onTextareaHover}
            onKeyDown={textareaKeyDown}
            placeholder="Your answer…"
            rows={3}
            className={[
              "w-full font-sans text-[12px] text-text-primary placeholder:text-text-quaternary bg-canvas border border-border rounded-md px-3 py-2 outline-none focus:border-status-info transition-colors resize-none leading-relaxed",
              flatStartIndex === keyboardFlatIdx ? "ring-1 ring-status-info ring-offset-1" : "",
            ].join(" ")}
          />
        )}
      </div>
    </div>
  );
});
