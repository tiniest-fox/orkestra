/**
 * Panel - Base container component with visual styling.
 * Features 12px border radius, drop shadow, and optional Header/Body/Footer subcomponents.
 *
 * By default, panels fill their container height (h-full) and use flex column layout.
 * This makes them work correctly inside PanelContainer and PanelSlot without extra styling.
 */

import type { ReactNode } from "react";
import { PanelBody } from "./PanelBody";
import { PanelCloseButton } from "./PanelCloseButton";
import { PanelFooter } from "./PanelFooter";
import { PanelHeader } from "./PanelHeader";
import { PanelTitle } from "./PanelTitle";

type PanelVariant = "default" | "elevated";
type PanelAccent = "none" | "info" | "warning";

interface PanelProps {
  children: ReactNode;
  variant?: PanelVariant;
  padded?: boolean;
  accent?: PanelAccent;
  /** Set to false to disable auto-fill behavior (h-full flex flex-col) */
  autoFill?: boolean;
  /** Additional CSS classes for custom styling */
  className?: string;
}

const variantStyles: Record<PanelVariant, string> = {
  default: "shadow-panel",
  elevated: "shadow-panel-elevated",
};

const accentStyles: Record<PanelAccent, string> = {
  none: "bg-white",
  info: "border-2 border-info bg-blue-50/30",
  warning: "bg-gradient-to-br from-amber-50 to-amber-100",
};

/**
 * Panel root component - container with rounded corners and shadow.
 */
function PanelRoot({
  children,
  variant = "default",
  accent = "none",
  autoFill = true,
  className = "",
  padded = false,
}: PanelProps) {
  let extraClasses = autoFill ? "grow shrink basis-0 flex flex-col" : "";
  if (padded) extraClasses += " p-2";

  return (
    <div
      className={`panel rounded-panel ${variantStyles[variant]} ${accentStyles[accent]} overflow-hidden ${extraClasses} ${className}`}
    >
      {children}
    </div>
  );
}

// Attach subcomponents to Panel
export const Panel = Object.assign(PanelRoot, {
  Header: PanelHeader,
  Title: PanelTitle,
  CloseButton: PanelCloseButton,
  Body: PanelBody,
  Footer: PanelFooter,
});
