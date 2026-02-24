/**
 * Panel - Base container component with visual styling.
 * Features 12px border radius, drop shadow, and optional Header/Body/Footer subcomponents.
 *
 * By default, panels fill their container height (h-full) and use flex column layout.
 * This makes them work correctly inside PanelContainer without extra styling.
 *
 * When used inside a PanelContainer, shadows are automatically suppressed (PanelContainer handles them).
 * Panel resets the context so nested Panels have normal shadows.
 *
 * Button mode: Pass `as="button"` to render as a native <button> element with interactive
 * shadow transitions (elevated on hover, flattened on press). This eliminates the need to
 * nest a <button> inside a Panel <div>.
 */

import { type ButtonHTMLAttributes, createContext, type ReactNode, useContext } from "react";
import { PanelContainerContext } from "../PanelContainer";
import { PanelBody } from "./PanelBody";
import { PanelCloseButton } from "./PanelCloseButton";
import { PanelFooter } from "./PanelFooter";
import { PanelHeader } from "./PanelHeader";
import { PanelTitle } from "./PanelTitle";

type PanelVariant = "default" | "elevated" | "flat";
type PanelAccent = "none" | "info" | "warning" | "error" | "success";

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
  none: "bg-surface",
  info: "bg-status-info-bg",
  warning: "bg-status-warning-bg",
  error: "bg-status-error-bg",
  success: "bg-status-success-bg",
};

// Context to reset shadow suppression for nested panels
const PanelResetContext = createContext<boolean>(false);

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

  const containerContext = useContext(PanelContainerContext);
  const isReset = useContext(PanelResetContext);
  const isButton = elementType === "button";

  // When inside a PanelContainer (and not reset): suppress shadows (container handles them)
  const shouldSuppressShadow = containerContext.inContainer && !isReset;
  const effectiveVariant = shouldSuppressShadow ? "flat" : variant;

  let extraClasses = autoFill ? "grow shrink basis-0 flex flex-col" : "";
  if (padded) extraClasses += " p-4";
  extraClasses += scrollable ? " overflow-y-auto overflow-x-hidden" : " overflow-hidden";

  // Button mode: interactive shadow transitions + button style resets + focus ring
  const buttonClasses = isButton
    ? "text-left appearance-none cursor-pointer transition-shadow duration-150 hover:shadow-panel-hover active:shadow-panel-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    : "";

  const combinedClassName = `panel rounded-panel ${variantStyles[effectiveVariant]} ${accentStyles[accent]} ${extraClasses} ${buttonClasses} ${className}`;

  if (isButton) {
    // Extract only button-specific props from rest
    const buttonProps = rest as Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof PanelBaseProps>;
    return (
      <PanelResetContext.Provider value={true}>
        <button type="button" {...buttonProps} className={combinedClassName}>
          {children}
        </button>
      </PanelResetContext.Provider>
    );
  }

  return (
    <PanelResetContext.Provider value={true}>
      <div className={combinedClassName}>{children}</div>
    </PanelResetContext.Provider>
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
