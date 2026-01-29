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
  scrolls?: boolean;
  className?: string;
  /** Gap between panels in pixels (default: 16) */
  gap?: number;
  padded?: boolean;
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
  gap = 8,
  scrolls = false,
  className = undefined,
  padded = false,
}: PanelContainerProps) {
  let extraClasses = direction === "horizontal" ? ["flex-row"] : ["flex-col"];
  extraClasses = extraClasses.concat(
    scrolls ? (direction === "horizontal" ? ["overflow-x-scroll"] : ["overflow-y-scroll"]) : [],
  );
  extraClasses = extraClasses.concat(padded ? ["p-2"] : []);

  return (
    <div
      className={`panel-container flex flex-1 ${extraClasses.join(" ")} h-full ${className ? className : ""}`}
      style={{ gap: `${gap}px` }}
    >
      {children}
    </div>
  );
}
