/**
 * User message log entry - session resume markers with context.
 */

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
};

export function UserMessageLogEntry({
  content,
  resumeType = "continue",
}: UserMessageLogEntryProps) {
  const style = RESUME_STYLES[resumeType] ?? RESUME_STYLES.continue;

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
        <div className="text-gray-200 text-sm">{content}</div>
      </div>
    </div>
  );
}
