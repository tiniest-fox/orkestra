/**
 * CollapsedSection - Expandable section for hidden context lines.
 *
 * Shows "N lines" button that reveals the lines when clicked.
 */

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
      className="w-full flex items-center justify-center py-1.5 text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
    >
      <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
        {lines.length} lines
      </span>
    </button>
  );
}
