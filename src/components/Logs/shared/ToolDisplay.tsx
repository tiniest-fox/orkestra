/**
 * Tool icon display component.
 */

import { getToolColor, getToolIcon } from "../../../utils/toolStyling";

interface ToolDisplayProps {
  tool: string;
  size?: number;
  className?: string;
}

export function ToolDisplay({ tool, size = 14, className = "" }: ToolDisplayProps) {
  return (
    <span
      className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-white ${getToolColor(tool)} ${className}`}
    >
      {getToolIcon(tool, size)}
    </span>
  );
}

interface SmallToolDisplayProps {
  tool: string;
  size?: number;
  className?: string;
}

export function SmallToolDisplay({ tool, size = 12, className = "" }: SmallToolDisplayProps) {
  return (
    <span
      className={`flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-white ${getToolColor(tool)} ${className}`}
    >
      {getToolIcon(tool, size)}
    </span>
  );
}
