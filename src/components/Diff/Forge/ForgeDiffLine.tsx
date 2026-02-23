//! Forge-themed diff line — single row with gutters and syntax-highlighted content.

import type { HighlightedLine } from "../../../hooks/useDiff";

interface ForgeDiffLineProps {
  line: HighlightedLine;
}

export function ForgeDiffLine({ line }: ForgeDiffLineProps) {
  const bgColor =
    line.line_type === "add"
      ? "bg-[var(--green-bg)]"
      : line.line_type === "delete"
        ? "bg-[var(--red-bg)]"
        : "bg-transparent";

  const hoverColor =
    line.line_type === "add"
      ? "hover:bg-[var(--green-gutter)]"
      : line.line_type === "delete"
        ? "hover:bg-[var(--red-gutter)]"
        : "hover:bg-[var(--surface-2)]";

  // Gutter must be fully opaque so it occludes code that scrolls behind it.
  const gutterBg =
    line.line_type === "add"
      ? "bg-[var(--green-gutter-solid)]"
      : line.line_type === "delete"
        ? "bg-[var(--red-gutter-solid)]"
        : "bg-[var(--canvas)]";

  const prefixColor =
    line.line_type === "add"
      ? "text-[var(--green)]"
      : line.line_type === "delete"
        ? "text-[var(--red)]"
        : "text-[var(--text-3)]";

  return (
    // min-w-max ensures the row expands to content width so the bg color fills behind long lines.
    // Wrapping rows (markdown) fill the container naturally and don't need this.
    <div
      className={`flex font-forge-mono text-forge-mono-md transition-colors ${bgColor} ${hoverColor}`}
    >
      <div className={`flex flex-shrink-0 ${gutterBg}`}>
        <div className="w-10 select-none text-right pr-2 text-[var(--text-3)]">
          {line.old_line_number ?? ""}
        </div>
        <div className="w-10 select-none text-right pr-2 text-[var(--text-3)] border-r border-[var(--border)]">
          {line.new_line_number ?? ""}
        </div>
        <div className={`w-4 select-none pl-2 ${prefixColor}`}>
          {line.line_type === "add" ? "+" : line.line_type === "delete" ? "-" : " "}
        </div>
      </div>
      {/* Syntax-highlighted content */}
      <div
        className="whitespace-pre-wrap break-words px-2 text-[var(--text-0)]"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect output is trusted
        dangerouslySetInnerHTML={{ __html: line.html }}
      />
    </div>
  );
}
