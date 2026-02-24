//! Collapsed context section — expand hidden lines on click.

import { useState } from "react";
import type { HighlightedLine } from "../../hooks/useDiff";
import { DiffLine } from "./DiffLine";

interface CollapsedSectionProps {
  lines: HighlightedLine[];
}

export function CollapsedSection({ lines }: CollapsedSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable within collapsed section
          <DiffLine key={i} line={line} />
        ))}
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
