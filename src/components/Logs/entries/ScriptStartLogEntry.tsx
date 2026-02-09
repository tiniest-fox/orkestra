/**
 * Script start log entry - displays script stage header.
 */

import { Terminal } from "lucide-react";

interface ScriptStartLogEntryProps {
  command: string;
  stage: string;
}

export function ScriptStartLogEntry({ command, stage }: ScriptStartLogEntryProps) {
  return (
    <div className="py-3 my-2">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-px bg-stone-300 dark:bg-stone-600" />
        <span className="text-xs text-cyan-600 dark:text-cyan-400 font-medium uppercase tracking-wider">
          Script Stage: {stage}
        </span>
        <div className="flex-1 h-px bg-stone-300 dark:bg-stone-600" />
      </div>
      <div className="flex items-start gap-2 px-3 py-2 bg-cyan-100 dark:bg-cyan-900/30 border-l-2 border-cyan-400 dark:border-cyan-500 rounded-r">
        <Terminal size={14} className="flex-shrink-0 mt-0.5 text-cyan-600 dark:text-cyan-400" />
        <code className="text-cyan-700 dark:text-cyan-200 text-sm font-mono">{command}</code>
      </div>
    </div>
  );
}
