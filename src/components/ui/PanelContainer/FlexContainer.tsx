/**
 * FlexContainer - Simple flex container for layout purposes.
 * Used for nested layouts within panels and other components.
 *
 * This is the original PanelContainer functionality, renamed to avoid
 * confusion with the grid-based PanelContainer used for main app layout.
 */

import type { ReactNode } from "react";

type Direction = "horizontal" | "vertical";

interface FlexContainerProps {
  children: ReactNode;
  direction?: Direction;
  scrolls?: boolean;
  className?: string;
  /** Gap between children in pixels (default: 8) */
  gap?: number;
  padded?: boolean;
}

export function FlexContainer({
  children,
  direction = "horizontal",
  gap = 8,
  scrolls = false,
  className = "",
  padded = false,
}: FlexContainerProps) {
  let extraClasses = direction === "horizontal" ? ["flex-row"] : ["flex-col"];
  extraClasses = extraClasses.concat(
    scrolls ? (direction === "horizontal" ? ["overflow-x-scroll"] : ["overflow-y-scroll"]) : [],
  );
  extraClasses = extraClasses.concat(padded ? ["p-2"] : []);

  return (
    <div
      className={`panel-container flex flex-1 ${extraClasses.join(" ")} h-full ${className}`}
      style={{ gap: `${gap}px` }}
    >
      {children}
    </div>
  );
}
