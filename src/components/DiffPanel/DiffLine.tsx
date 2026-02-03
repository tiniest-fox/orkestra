/**
 * DiffLine - Single line in a diff view with dual line number gutters and syntax highlighting.
 */

import type { HighlightedLine } from "../../hooks/useDiff";

interface DiffLineProps {
  line: HighlightedLine;
}

export function DiffLine({ line }: DiffLineProps) {
  const bgColor =
    line.line_type === "add"
      ? "bg-green-50 dark:bg-green-950/30"
      : line.line_type === "delete"
        ? "bg-red-50 dark:bg-red-950/30"
        : "";

  return (
    <div className={`flex font-mono text-sm ${bgColor}`}>
      {/* Old line number gutter */}
      <div className="w-[50px] flex-shrink-0 text-right pr-2 text-stone-400 dark:text-stone-500 select-none">
        {line.old_line_number !== null ? line.old_line_number : ""}
      </div>

      {/* New line number gutter */}
      <div className="w-[50px] flex-shrink-0 text-right pr-2 text-stone-400 dark:text-stone-500 select-none">
        {line.new_line_number !== null ? line.new_line_number : ""}
      </div>

      {/* Line content with syntax highlighting */}
      <div
        className="flex-1 whitespace-pre overflow-x-auto"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Syntax highlighting HTML is server-generated via syntect
        dangerouslySetInnerHTML={{ __html: line.html }}
      />
    </div>
  );
}
