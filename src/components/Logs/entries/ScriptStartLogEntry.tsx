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
        <div className="flex-1 h-px bg-gray-600" />
        <span className="text-xs text-cyan-400 font-medium uppercase tracking-wider">
          Script Stage: {stage}
        </span>
        <div className="flex-1 h-px bg-gray-600" />
      </div>
      <div className="flex items-start gap-2 px-3 py-2 bg-cyan-900/30 border-l-2 border-cyan-500 rounded-r">
        <Terminal size={14} className="flex-shrink-0 mt-0.5 text-cyan-400" />
        <code className="text-cyan-200 text-sm font-mono">{command}</code>
      </div>
    </div>
  );
}
