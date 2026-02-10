/**
 * Script exit log entry - displays script completion status.
 */

import { FileOutput, XCircle } from "lucide-react";

interface ScriptExitLogEntryProps {
  code: number;
  success: boolean;
  timedOut: boolean;
}

export function ScriptExitLogEntry({ code, success, timedOut }: ScriptExitLogEntryProps) {
  const exitColor = success
    ? "text-success-600 dark:text-success-400"
    : "text-error-600 dark:text-error-400";
  const exitBg = success
    ? "bg-success-100 dark:bg-success-900/30"
    : "bg-error-100 dark:bg-error-900/30";
  const exitBorder = success ? "border-success-500" : "border-error-500";
  const exitLabel = timedOut
    ? "Script timed out"
    : success
      ? "Script completed successfully"
      : `Script failed (exit code ${code})`;

  return (
    <div className={`py-2 px-3 my-2 ${exitBg} border-l-2 ${exitBorder} rounded-r`}>
      <div className={`text-sm ${exitColor} flex items-center gap-2`}>
        {success ? <FileOutput size={14} /> : <XCircle size={14} />}
        {exitLabel}
      </div>
    </div>
  );
}
