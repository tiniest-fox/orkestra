/**
 * CollapsibleSection - Expandable section with toggle header.
 *
 * Renders a clickable header bar with title, optional count badge, and chevron.
 * Children are shown only when expanded.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  count,
  defaultExpanded = false,
  children,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full py-1.5 px-2 rounded text-sm font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-stone-500 dark:text-stone-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-stone-500 dark:text-stone-400" />
        )}
        <span>{title}</span>
        {count !== undefined && (
          <span className="text-xs text-stone-500 dark:text-stone-400">({count})</span>
        )}
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}
