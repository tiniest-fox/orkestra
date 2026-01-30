/**
 * Panel - Base container component with visual styling.
 * Features 12px border radius, drop shadow, and optional Header/Body/Footer subcomponents.
 *
 * By default, panels fill their container height (h-full) and use flex column layout.
 * This makes them work correctly inside PanelContainer and PanelSlot without extra styling.
 *
 * When used inside a PanelSlot, shadows are automatically suppressed (PanelSlot handles them).
 * Panel resets the PanelSlot context so nested Panels have normal shadows.
 *
 * Button mode: Pass `as="button"` to render as a native <button> element with interactive
 * shadow transitions (elevated on hover, flattened on press). This eliminates the need to
 * nest a <button> inside a Panel <div>.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PanelSlotContext, usePanelSlot } from "../PanelSlot";
import { PanelBody } from "./PanelBody";
import { PanelCloseButton } from "./PanelCloseButton";
import { PanelFooter } from "./PanelFooter";
import { PanelHeader } from "./PanelHeader";
import { PanelTitle } from "./PanelTitle";

type PanelVariant = "default" | "elevated" | "flat";
type PanelAccent = "none" | "info" | "warning" | "error";

interface PanelBaseProps {
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

interface PanelDivProps extends PanelBaseProps {
  as?: "div";
}

interface PanelButtonProps
  extends PanelBaseProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof PanelBaseProps> {
  as: "button";
}

type PanelProps = PanelDivProps | PanelButtonProps;

const variantStyles: Record<PanelVariant, string> = {
  default: "shadow-panel",
  elevated: "shadow-panel-elevated",
  flat: "",
};

const accentStyles: Record<PanelAccent, string> = {
  none: "bg-white dark:bg-stone-900",
  info: "bg-gradient-to-br from-info-50 to-info-100 dark:from-info-950 dark:to-info-900",
  warning:
    "bg-gradient-to-br from-warning-50 to-warning-100 dark:from-warning-950 dark:to-warning-900",
  error: "bg-gradient-to-br from-error-50 to-error-100 dark:from-error-950 dark:to-error-900",
};

/**
 * Panel root component - container with rounded corners and shadow.
 */
function PanelRoot(props: PanelProps) {
  const {
    children,
    variant = "default",
    accent = "none",
    autoFill = true,
    className = "",
    padded = false,
    scrollable = false,
    as: elementType,
    ...rest
  } = props;

  const slotContext = usePanelSlot();
  const isButton = elementType === "button";

  // When inside a PanelSlot: suppress shadows (slot handles them)
  const effectiveVariant = slotContext?.suppressShadow ? "flat" : variant;

  let extraClasses = autoFill ? "grow shrink basis-0 flex flex-col" : "";
  if (padded) extraClasses += " p-4";
  extraClasses += scrollable ? " overflow-y-auto overflow-x-hidden" : " overflow-hidden";

  // Button mode: interactive shadow transitions + button style resets + focus ring
  const buttonClasses = isButton
    ? "text-left appearance-none cursor-pointer transition-shadow duration-150 hover:shadow-panel-hover active:shadow-panel-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900"
    : "";

  const combinedClassName = `panel rounded-panel ${variantStyles[effectiveVariant]} ${accentStyles[accent]} ${extraClasses} ${buttonClasses} ${className}`;

  if (isButton) {
    // Extract only button-specific props from rest
    const buttonProps = rest as Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof PanelBaseProps>;
    return (
      <PanelSlotContext.Provider value={null}>
        <button type="button" {...buttonProps} className={combinedClassName}>
          {children}
        </button>
      </PanelSlotContext.Provider>
    );
  }

  return (
    <PanelSlotContext.Provider value={null}>
      <div className={combinedClassName}>{children}</div>
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
