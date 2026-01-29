/**
 * Tool use log entry - displays tool invocations with icon and summary.
 */

import type { ToolInput } from "../../../types/workflow";
import { getStructuredOutputStyle } from "../../../utils/toolStyling";
import { ToolDisplay } from "../shared/ToolDisplay";
import { ToolInputSummary } from "../shared/ToolInputSummary";

interface ToolUseLogEntryProps {
  tool: string;
  input: ToolInput;
}

export function ToolUseLogEntry({ tool, input }: ToolUseLogEntryProps) {
  // Special handling for StructuredOutput to get type-specific styling
  if (input.tool === "structured_output") {
    const style = getStructuredOutputStyle(input.output_type);
    return (
      <div className="py-1.5 flex items-start gap-2">
        <span
          className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-white ${style.color}`}
        >
          {style.icon}
        </span>
        <div className="flex-1 min-w-0">
          <ToolInputSummary input={input} />
        </div>
      </div>
    );
  }

  return (
    <div className="py-1.5 flex items-start gap-2">
      <ToolDisplay tool={tool} />
      <div className="flex-1 min-w-0">
        <ToolInputSummary input={input} />
      </div>
    </div>
  );
}
