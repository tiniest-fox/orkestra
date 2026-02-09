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
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";
  const exitBg = success ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30";
  const exitBorder = success ? "border-green-500" : "border-red-500";
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
