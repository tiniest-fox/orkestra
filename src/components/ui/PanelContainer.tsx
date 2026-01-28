/**
 * PanelContainer - Flex container that holds multiple Panels with controlled sizing.
 * Manages gaps between panels and supports horizontal/vertical layouts.
 *
 * Features:
 * - Auto-fills available space (flex-1) by default
 * - Subtle vignette effect for visual depth
 * - Negative margin + padding technique to prevent shadow clipping
 */

import type { ReactNode } from "react";

type Direction = "horizontal" | "vertical";

interface PanelContainerProps {
  children: ReactNode;
  direction?: Direction;
  /** Gap between panels in pixels (default: 16) */
  gap?: number;
}

/**
 * PanelContainer - Manages layout of multiple panels.
 *
 * Auto-fills available space and includes padding for panel shadows.
 * Children can control their sizing via className:
 * - `flex-1` (fill): takes equal share of remaining space
 * - `flex-shrink-0 w-[480px]` (fit): fixed width, doesn't grow or shrink
 */
export function PanelContainer({
  children,
  direction = "horizontal",
  gap = 16,
}: PanelContainerProps) {
  const directionClass = direction === "horizontal" ? "flex-row" : "flex-col";

  return (
    // Outer wrapper: applies vignette and handles overflow for child shadows
    // Uses negative margin to extend into parent padding, with matching padding to maintain spacing
    <div className="flex-1 -m-2 p-2 rounded-panel shadow-panel-container-vignette overflow-visible">
      <div className={`flex ${directionClass} h-full`} style={{ gap: `${gap}px` }}>
        {children}
      </div>
    </div>
  );
}
