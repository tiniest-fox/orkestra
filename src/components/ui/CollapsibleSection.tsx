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
  className?: string;
}

export function CollapsibleSection({
  title,
  count,
  defaultExpanded = false,
  children,
  className,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full py-1.5 px-2 rounded text-sm font-medium text-text-secondary hover:bg-canvas transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-tertiary" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-tertiary" />
        )}
        <span>{title}</span>
        {count !== undefined && <span className="text-xs text-text-tertiary">({count})</span>}
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}
