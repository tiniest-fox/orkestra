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
  { label: string; textColor: string; bgColor: string; borderColor: string }
> = {
  continue: {
    label: "Session Resumed",
    textColor: "text-blue-400",
    bgColor: "bg-blue-900/30",
    borderColor: "border-blue-500",
  },
  feedback: {
    label: "Feedback Requested",
    textColor: "text-amber-400",
    bgColor: "bg-amber-900/30",
    borderColor: "border-amber-500",
  },
  integration: {
    label: "Integration Conflict",
    textColor: "text-red-400",
    bgColor: "bg-red-900/30",
    borderColor: "border-red-500",
  },
  answers: {
    label: "Questions Answered",
    textColor: "text-green-400",
    bgColor: "bg-green-900/30",
    borderColor: "border-green-500",
  },
  initial: {
    label: "Initial Prompt",
    textColor: "text-purple-400",
    bgColor: "bg-purple-900/30",
    borderColor: "border-purple-500",
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
    <div className="py-3 my-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-px bg-gray-600" />
        <span className={`text-xs ${style.textColor} font-medium uppercase tracking-wider`}>
          {style.label}
        </span>
        <div className="flex-1 h-px bg-gray-600" />
      </div>
      <div className={`px-3 py-2 ${style.bgColor} border-l-2 ${style.borderColor} rounded-r`}>
        <div className="relative">
          <div
            ref={measureRef}
            className="text-gray-200 text-sm whitespace-pre-wrap overflow-hidden"
            style={!expanded && overflows ? { maxHeight: `${MAX_HEIGHT_PX}px` } : undefined}
          >
            {content}
          </div>
          {overflows && !expanded && (
            <div
              className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
              style={{
                background: "linear-gradient(transparent, rgba(0, 0, 0, 0.6))",
              }}
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
