//! Diff line — single row with gutters and syntax-highlighted content.

import type { HighlightedLine } from "../../hooks/useDiff";

interface DiffLineProps {
  line: HighlightedLine;
}

export function DiffLine({ line }: DiffLineProps) {
  const bgColor =
    line.line_type === "add"
      ? "bg-status-success-bg"
      : line.line_type === "delete"
        ? "bg-status-error-bg"
        : "bg-transparent";

  const hoverColor =
    line.line_type === "add"
      ? "hover:bg-[rgba(22,163,74,0.13)]"
      : line.line_type === "delete"
        ? "hover:bg-[rgba(220,38,38,0.11)]"
        : "hover:bg-surface-2";

  // Gutter must be fully opaque so it occludes code that scrolls behind it.
  const gutterBg =
    line.line_type === "add"
      ? "bg-[#DCEDE5]"
      : line.line_type === "delete"
        ? "bg-[#F7E1E5]"
        : "bg-canvas";

  const prefixColor =
    line.line_type === "add"
      ? "text-status-success"
      : line.line_type === "delete"
        ? "text-status-error"
        : "text-text-quaternary";

  return (
    // min-w-max ensures the row expands to content width so the bg color fills behind long lines.
    // Wrapping rows (markdown) fill the container naturally and don't need this.
    <div className={`flex font-mono text-forge-mono-md transition-colors ${bgColor} ${hoverColor}`}>
      <div className={`flex flex-shrink-0 ${gutterBg}`}>
        <div className="w-10 select-none text-right pr-2 text-text-quaternary">
          {line.old_line_number ?? ""}
        </div>
        <div className="w-10 select-none text-right pr-2 text-text-quaternary border-r border-border">
          {line.new_line_number ?? ""}
        </div>
        <div className={`w-4 select-none pl-2 ${prefixColor}`}>
          {line.line_type === "add" ? "+" : line.line_type === "delete" ? "-" : " "}
        </div>
      </div>
      {/* Syntax-highlighted content */}
      <div
        className="whitespace-pre-wrap break-words px-2 text-text-primary"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect output is trusted
        dangerouslySetInnerHTML={{ __html: line.html }}
      />
    </div>
  );
}
