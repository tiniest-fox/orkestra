//! Diff line — single row with gutters and syntax-highlighted content.

import type { HighlightedLine } from "../../hooks/useDiff";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { SearchRange } from "./highlightSearchInHtml";
import { highlightSearchInHtml } from "./highlightSearchInHtml";

interface DiffLineProps {
  line: HighlightedLine;
  onOpenCommentInput?: () => void;
  searchRanges?: SearchRange[];
  isCurrentMatchLine?: boolean; // kept for data-search-current scroll targeting
}

export function DiffLine({
  line,
  onOpenCommentInput,
  searchRanges,
  isCurrentMatchLine,
}: DiffLineProps) {
  const isMobile = useIsMobile();
  const bgColor =
    line.line_type === "add"
      ? "bg-status-success-bg"
      : line.line_type === "delete"
        ? "bg-status-error-bg"
        : "bg-transparent";

  const hoverColor =
    line.line_type === "add"
      ? "hover:bg-[var(--forge-diff-add-hover)]"
      : line.line_type === "delete"
        ? "hover:bg-[var(--forge-diff-del-hover)]"
        : "hover:bg-surface-2";

  // Gutter must be fully opaque so it occludes code that scrolls behind it.
  const gutterBg =
    line.line_type === "add"
      ? "bg-[var(--forge-diff-add-gutter)]"
      : line.line_type === "delete"
        ? "bg-[var(--forge-diff-del-gutter)]"
        : "bg-surface";

  const prefixColor =
    line.line_type === "add"
      ? "text-status-success"
      : line.line_type === "delete"
        ? "text-status-error"
        : "text-text-quaternary";

  const displayHtml = searchRanges?.length
    ? highlightSearchInHtml(line.html, searchRanges)
    : line.html;

  return (
    // min-w-max ensures the row expands to content width so the bg color fills behind long lines.
    // Wrapping rows (markdown) fill the container naturally and don't need this.
    <div
      data-search-current={isCurrentMatchLine ? "true" : undefined}
      className={`group relative flex font-mono text-forge-mono-md transition-colors ${bgColor} ${hoverColor}`}
    >
      <div className={`flex flex-shrink-0 ${gutterBg}`}>
        <div className="relative w-10 select-none text-right pr-2 text-text-quaternary">
          {line.old_line_number ?? ""}
          {onOpenCommentInput && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenCommentInput();
              }}
              // Satisfies Biome useKeyWithClickEvents — button is click-only
              onKeyDown={() => {}}
              aria-label="Add comment"
              className={`absolute inset-y-0 left-0 right-0 flex items-center justify-center ${isMobile ? "opacity-30" : "opacity-0 group-hover:opacity-100"} transition-opacity`}
            >
              <span className="w-4 h-4 rounded-full bg-status-info text-white text-[10px] font-bold flex items-center justify-center leading-none">
                +
              </span>
            </button>
          )}
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
        dangerouslySetInnerHTML={{ __html: displayHtml }}
      />
    </div>
  );
}
