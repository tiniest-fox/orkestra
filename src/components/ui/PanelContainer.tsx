/**
 * PanelContainer - Flex container that holds multiple Panels with controlled sizing.
 * Manages gaps between panels and supports horizontal/vertical layouts.
 */

import type { ReactNode } from "react";

type Direction = "horizontal" | "vertical";

interface PanelContainerProps {
  children: ReactNode;
  direction?: Direction;
  /** Gap between panels in pixels (default: 16) */
  gap?: number;
  className?: string;
}

/**
 * PanelContainer - Manages layout of multiple panels.
 *
 * Children can control their sizing via className:
 * - `flex-1` (fill): takes equal share of remaining space
 * - `flex-shrink-0 w-[480px]` (fit): fixed width, doesn't grow or shrink
 */
export function PanelContainer({
  children,
  direction = "horizontal",
  gap = 16,
  className = "",
}: PanelContainerProps) {
  const directionClass = direction === "horizontal" ? "flex-row" : "flex-col";

  return (
    <div className={`flex ${directionClass} ${className}`} style={{ gap: `${gap}px` }}>
      {children}
    </div>
  );
}
