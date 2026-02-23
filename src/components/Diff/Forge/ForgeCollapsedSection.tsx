//! Forge-themed collapsed context section — expand hidden lines on click.

import { useState } from "react";
import type { HighlightedLine } from "../../../hooks/useDiff";
import { ForgeDiffLine } from "./ForgeDiffLine";

interface ForgeCollapsedSectionProps {
  lines: HighlightedLine[];
}

export function ForgeCollapsedSection({ lines }: ForgeCollapsedSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable within collapsed section
          <ForgeDiffLine key={i} line={line} />
        ))}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="w-full flex items-center justify-center py-1.5 font-forge-sans text-forge-body text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-2)] transition-colors"
    >
      <span className="px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-2)]">
        {lines.length} lines
      </span>
    </button>
  );
}
