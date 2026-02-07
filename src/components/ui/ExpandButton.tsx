/**
 * ExpandButton - Sticky icon button that toggles an ExpandablePanel.
 *
 * Shows a maximize icon when collapsed and a minimize icon when expanded.
 * Sticks to the top-right corner of its scroll container so it remains
 * visible as users scroll through long content.
 *
 * Must be rendered inside an ExpandablePanel to access the toggle state.
 * Renders nothing if no ExpandablePanel ancestor exists.
 */

import { Maximize2, Minimize2 } from "lucide-react";
import { useExpandablePanel } from "./ExpandablePanel";
import { IconButton } from "./IconButton";

/**
 * ExpandButton - Sticky toggle for expanding/collapsing a panel.
 *
 * Place this inside the scrollable area of an ExpandablePanel.
 * It floats in the top-right corner and stays visible on scroll.
 */
export function ExpandButton() {
  const expandable = useExpandablePanel();
  if (!expandable) return null;

  const { isExpanded, toggle } = expandable;

  return (
    <div className="sticky top-2 z-10 flex justify-end pointer-events-none h-0 overflow-visible">
      <IconButton
        icon={isExpanded ? <Minimize2 /> : <Maximize2 />}
        aria-label={isExpanded ? "Collapse panel" : "Expand panel"}
        variant="secondary"
        size="sm"
        onClick={toggle}
        className="pointer-events-auto mt-1 mr-1 shrink-0 h-8 w-8"
      />
    </div>
  );
}
