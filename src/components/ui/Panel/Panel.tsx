/**
 * Panel - Base container component with visual styling.
 * Features 12px border radius, drop shadow, and optional Header/Body/Footer subcomponents.
 *
 * By default, panels fill their container height (h-full) and use flex column layout.
 * This makes them work correctly inside PanelContainer and PanelSlot without extra styling.
 *
 * When used inside a PanelSlot, shadows are automatically suppressed (PanelSlot handles them).
 * Panel resets the PanelSlot context so nested Panels have normal shadows.
 */

import type { ReactNode } from "react";
import { PanelSlotContext, usePanelSlot } from "../PanelSlot";
import { PanelBody } from "./PanelBody";
import { PanelCloseButton } from "./PanelCloseButton";
import { PanelFooter } from "./PanelFooter";
import { PanelHeader } from "./PanelHeader";
import { PanelTitle } from "./PanelTitle";

type PanelVariant = "default" | "elevated" | "flat";
type PanelAccent = "none" | "info" | "warning" | "error";

interface PanelProps {
  children: ReactNode;
  variant?: PanelVariant;
  padded?: boolean;
  accent?: PanelAccent;
  /** Set to false to disable auto-fill behavior (h-full flex flex-col) */
  autoFill?: boolean;
  /** Additional CSS classes for custom styling */
  className?: string;
  scrollable?: boolean;
}

const variantStyles: Record<PanelVariant, string> = {
  default: "shadow-panel",
  elevated: "shadow-panel-elevated",
  flat: "",
};

const accentStyles: Record<PanelAccent, string> = {
  none: "bg-white",
  info: "bg-gradient-to-br from-info-50 to-info-100",
  warning: "bg-gradient-to-br from-warning-50 to-warning-100",
  error: "bg-gradient-to-br from-error-50 to-error-100",
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
  scrollable = false,
}: PanelProps) {
  const slotContext = usePanelSlot();

  // When inside a PanelSlot: suppress shadows (slot handles them)
  const effectiveVariant = slotContext?.suppressShadow ? "flat" : variant;

  let extraClasses = autoFill ? "grow shrink basis-0 flex flex-col" : "";
  if (padded) extraClasses += " p-4";
  extraClasses += scrollable ? " overflow-y-auto overflow-x-hidden" : " overflow-hidden";

  return (
    <PanelSlotContext.Provider value={null}>
      <div
        className={`panel rounded-panel ${variantStyles[effectiveVariant]} ${accentStyles[accent]} ${extraClasses} ${className}`}
      >
        {children}
      </div>
    </PanelSlotContext.Provider>
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
