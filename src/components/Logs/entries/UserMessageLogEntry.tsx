/**
 * User message log entry - session resume markers and initial prompts with context.
 */

import { useCallback, useState } from "react";
import type { ResumeType } from "../../../types/workflow";

interface UserMessageLogEntryProps {
  content: string;
  resumeType?: ResumeType;
}

const RESUME_STYLES: Record<
  ResumeType,
  { label: string; textColor: string; bgColor: string; gradientTo: string }
> = {
  continue: {
    label: "RESUMING SESSION",
    textColor: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    gradientTo: "to-blue-100 dark:to-blue-900/30",
  },
  feedback: {
    label: "FEEDBACK",
    textColor: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    gradientTo: "to-amber-100 dark:to-amber-900/30",
  },
  integration: {
    label: "INTEGRATION FAILED",
    textColor: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
    gradientTo: "to-red-100 dark:to-red-900/30",
  },
  answers: {
    label: "ANSWERS PROVIDED",
    textColor: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    gradientTo: "to-green-100 dark:to-green-900/30",
  },
  retry_failed: {
    label: "RETRYING",
    textColor: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
    gradientTo: "to-orange-100 dark:to-orange-900/30",
  },
  retry_blocked: {
    label: "RETRYING",
    textColor: "text-yellow-600 dark:text-yellow-400",
    bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
    gradientTo: "to-yellow-100 dark:to-yellow-900/30",
  },
  initial: {
    label: "INITIAL PROMPT",
    textColor: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
    gradientTo: "to-purple-100 dark:to-purple-900/30",
  },
};

const MAX_HEIGHT_PX = 160;

export function UserMessageLogEntry({
  content,
  resumeType = "continue",
}: UserMessageLogEntryProps) {
  const style = RESUME_STYLES[resumeType] ?? RESUME_STYLES.continue;
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      setOverflows(el.scrollHeight > MAX_HEIGHT_PX);
    }
  }, []);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  return (
    <div className="flex justify-end my-3">
      <div className={`max-w-[85%] px-4 py-3 ${style.bgColor} rounded-2xl`}>
        <div className={`text-xs font-medium uppercase tracking-wider mb-1 ${style.textColor}`}>
          {style.label}
        </div>
        <div className="relative">
          <div
            ref={measureRef}
            className="text-stone-700 dark:text-stone-200 text-sm whitespace-pre-wrap overflow-hidden"
            style={!expanded && overflows ? { maxHeight: `${MAX_HEIGHT_PX}px` } : undefined}
          >
            {content}
          </div>
          {overflows && !expanded && (
            <div
              className={`absolute bottom-0 left-0 right-0 h-12 pointer-events-none bg-gradient-to-b from-transparent ${style.gradientTo}`}
            />
          )}
        </div>
        {overflows && (
          <button
            type="button"
            onClick={toggleExpanded}
            className={`mt-1 text-xs ${style.textColor} hover:underline cursor-pointer`}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}
