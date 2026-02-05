/**
 * DiffLine - Single line in a diff hunk.
 *
 * Displays:
 * - Dual gutters (old/new line numbers)
 * - Subtle background color (green/red/neutral)
 * - Syntax-highlighted content via dangerouslySetInnerHTML
 */

import type { HighlightedLine } from "../../hooks/useDiff";

interface DiffLineProps {
  line: HighlightedLine;
}

export function DiffLine({ line }: DiffLineProps) {
  const bgColor =
    line.line_type === "add"
      ? "bg-success-50 dark:bg-success-950/50"
      : line.line_type === "delete"
        ? "bg-error-50 dark:bg-error-950/50"
        : "bg-transparent";

  const hoverColor =
    line.line_type === "add"
      ? "hover:bg-success-100 dark:hover:bg-success-900/50"
      : line.line_type === "delete"
        ? "hover:bg-error-100 dark:hover:bg-error-900/50"
        : "hover:bg-stone-50 dark:hover:bg-stone-800/50";

  const gutterBg =
    line.line_type === "add"
      ? "bg-success-100 dark:bg-success-900/50"
      : line.line_type === "delete"
        ? "bg-error-100 dark:bg-error-900/50"
        : "bg-transparent";

  const prefixColor =
    line.line_type === "add"
      ? "text-success-600 dark:text-success-400"
      : line.line_type === "delete"
        ? "text-error-600 dark:text-error-400"
        : "text-stone-400 dark:text-stone-500";

  return (
    <div className={`flex font-mono text-xs leading-5 ${bgColor} ${hoverColor} transition-colors`}>
      {/* Old line number */}
      <div
        className={`w-10 flex-shrink-0 select-none text-right pr-2 text-stone-400 dark:text-stone-500 ${gutterBg}`}
      >
        {line.old_line_number ?? ""}
      </div>

      {/* New line number */}
      <div
        className={`w-10 flex-shrink-0 select-none text-right pr-2 text-stone-400 dark:text-stone-500 border-r border-stone-200 dark:border-stone-700 ${gutterBg}`}
      >
        {line.new_line_number ?? ""}
      </div>

      {/* Prefix (+/-/ ) */}
      <div className={`w-4 flex-shrink-0 select-none pl-2 ${prefixColor}`}>
        {line.line_type === "add" ? "+" : line.line_type === "delete" ? "-" : " "}
      </div>

      {/* Syntax-highlighted content */}
      <div
        className="flex-1 whitespace-pre-wrap break-all px-2 text-stone-700 dark:text-stone-300"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect output is trusted
        dangerouslySetInnerHTML={{ __html: line.html }}
      />
    </div>
  );
}
