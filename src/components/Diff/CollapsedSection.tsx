/**
 * CollapsedSection - Expandable section for hidden context lines.
 *
 * Shows "⋮ N lines hidden" button that reveals the lines when clicked.
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
      className="w-full flex items-center justify-center py-1 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
    >
      <span className="mr-2">⋮</span>
      <span>{lines.length} lines hidden</span>
    </button>
  );
}
