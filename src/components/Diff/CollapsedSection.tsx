//! Collapsed context section — expand hidden lines on click.

import { useState } from "react";
import type { HighlightedLine } from "../../hooks/useDiff";
import { DiffLine } from "./DiffLine";
import type { SearchRange } from "./highlightSearchInHtml";
import type { DiffMatch } from "./useDiffSearch";

interface CollapsedSectionProps {
  lines: HighlightedLine[];
  forceExpanded?: boolean;
  /** The hunk index this section belongs to (used to compute per-line match keys). */
  hunkIndex?: number;
  /** The original line index within the hunk of the first line in this section. */
  startLineIndex?: number;
  fileMatches?: DiffMatch[];
  currentMatch?: DiffMatch | null;
}

export function CollapsedSection({
  lines,
  forceExpanded,
  hunkIndex,
  startLineIndex = 0,
  fileMatches,
  currentMatch,
}: CollapsedSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (expanded || forceExpanded) {
    return (
      <>
        {lines.map((line, i) => {
          const absIndex = startLineIndex + i;
          // Context lines always have line numbers — use them as stable keys unrelated to i.
          const reactKey = (line.new_line_number ?? line.old_line_number) as number;

          const lineMatches = (fileMatches ?? []).filter(
            (m) => hunkIndex !== undefined && m.hunkIndex === hunkIndex && m.lineIndex === absIndex,
          );
          const searchRanges: SearchRange[] = lineMatches.map((m) => ({
            charStart: m.charStart,
            charEnd: m.charEnd,
            isCurrent:
              currentMatch != null &&
              m.hunkIndex === currentMatch.hunkIndex &&
              m.lineIndex === currentMatch.lineIndex &&
              m.charStart === currentMatch.charStart &&
              m.charEnd === currentMatch.charEnd,
          }));
          const isCurrentMatchLine = searchRanges.some((r) => r.isCurrent);

          return (
            <DiffLine
              key={reactKey}
              line={line}
              searchRanges={searchRanges.length > 0 ? searchRanges : undefined}
              isCurrentMatchLine={isCurrentMatchLine}
            />
          );
        })}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="w-full flex items-center justify-center py-1.5 font-sans text-forge-body text-text-quaternary hover:text-text-tertiary hover:bg-surface-2 transition-colors"
    >
      <span className="px-2 py-0.5 rounded bg-surface-3 text-text-tertiary">
        {lines.length} lines
      </span>
    </button>
  );
}
