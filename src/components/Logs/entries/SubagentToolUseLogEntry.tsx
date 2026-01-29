/**
 * Subagent tool use log entry - displays tool invocations from subagents.
 */

import type { ToolInput } from "../../../types/workflow";
import { SmallToolDisplay } from "../shared/ToolDisplay";
import { ToolInputSummary } from "../shared/ToolInputSummary";

interface SubagentToolUseLogEntryProps {
  tool: string;
  input: ToolInput;
}

export function SubagentToolUseLogEntry({ tool, input }: SubagentToolUseLogEntryProps) {
  return (
    <div className="py-1 ml-6 flex items-start gap-2 opacity-75">
      <SmallToolDisplay tool={tool} />
      <div className="flex-1 min-w-0">
        <ToolInputSummary input={input} />
      </div>
    </div>
  );
}
