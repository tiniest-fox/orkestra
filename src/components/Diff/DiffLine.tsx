/**
 * DiffLine - Single line in a diff hunk.
 *
 * Displays:
 * - Dual gutters (old/new line numbers)
 * - Background color (green/red/neutral)
 * - Syntax-highlighted content via dangerouslySetInnerHTML
 */

import type { HighlightedLine } from "../../hooks/useDiff";

interface DiffLineProps {
  line: HighlightedLine;
}

export function DiffLine({ line }: DiffLineProps) {
  const bgColor =
    line.line_type === "add"
      ? "bg-green-500/10 hover:bg-green-500/15"
      : line.line_type === "delete"
        ? "bg-red-500/10 hover:bg-red-500/15"
        : "bg-transparent hover:bg-gray-500/5";

  const gutterBg =
    line.line_type === "add"
      ? "bg-green-500/20"
      : line.line_type === "delete"
        ? "bg-red-500/20"
        : "bg-transparent";

  return (
    <div className={`flex font-mono text-xs leading-5 ${bgColor} transition-colors`}>
      {/* Old line number */}
      <div
        className={`w-12 flex-shrink-0 select-none text-right pr-2 text-gray-500 ${gutterBg}`}
      >
        {line.old_line_number ?? ""}
      </div>

      {/* New line number */}
      <div
        className={`w-12 flex-shrink-0 select-none text-right pr-2 text-gray-500 border-r border-gray-700 ${gutterBg}`}
      >
        {line.new_line_number ?? ""}
      </div>

      {/* Prefix (+/-/ ) */}
      <div className="w-4 flex-shrink-0 select-none text-gray-500 pl-2">
        {line.line_type === "add" ? "+" : line.line_type === "delete" ? "-" : " "}
      </div>

      {/* Syntax-highlighted content */}
      <div
        className="flex-1 whitespace-pre-wrap break-all px-2"
        dangerouslySetInnerHTML={{ __html: line.html }}
      />
    </div>
  );
}
