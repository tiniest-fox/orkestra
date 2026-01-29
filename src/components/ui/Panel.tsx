/**
 * Panel - Base container component with visual styling.
 * Features 12px border radius, drop shadow, and optional Header/Body/Footer subcomponents.
 *
 * By default, panels fill their container height (h-full) and use flex column layout.
 * This makes them work correctly inside PanelContainer and PanelSlot without extra styling.
 */

import type { ReactNode } from "react";

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

interface PanelHeaderProps {
  children: ReactNode;
  className?: string;
}

interface PanelTitleProps {
  children: ReactNode;
  className?: string;
}

interface PanelCloseButtonProps {
  onClick: () => void;
  className?: string;
}

interface PanelBodyProps {
  children: ReactNode;
  className?: string;
  /** Allow body to scroll independently */
  scrollable?: boolean;
}

interface PanelFooterProps {
  children: ReactNode;
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
export function Panel({
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

/**
 * Panel.Header - Fixed header section.
 */
function PanelHeader({ children, className = "" }: PanelHeaderProps) {
  return (
    <div className={`flex-shrink-0 flex items-center justify-between px-4 py-3 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Panel.Title - Styled heading within Panel.Header.
 */
function PanelTitle({ children, className = "" }: PanelTitleProps) {
  return (
    <h2 className={`font-heading font-semibold text-lg text-stone-800 ${className}`}>{children}</h2>
  );
}

/**
 * Panel.CloseButton - Close button for panels.
 */
function PanelCloseButton({ onClick, className = "" }: PanelCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 p-1.5 hover:bg-stone-100 rounded-panel-sm transition-colors ${className}`}
      aria-label="Close"
    >
      <svg
        className="w-5 h-5 text-stone-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </button>
  );
}

/**
 * Panel.Body - Main content area, optionally scrollable.
 */
function PanelBody({ children, className = "", scrollable = false }: PanelBodyProps) {
  const scrollClasses = scrollable ? "flex-1 overflow-auto" : "";
  return <div className={`p-4 ${scrollClasses} ${className}`}>{children}</div>;
}

/**
 * Panel.Footer - Fixed footer section.
 */
function PanelFooter({ children, className = "" }: PanelFooterProps) {
  return <div className={`flex-shrink-0 px-4 py-3 ${className}`}>{children}</div>;
}

// Attach subcomponents to Panel
Panel.Header = PanelHeader;
Panel.Title = PanelTitle;
Panel.CloseButton = PanelCloseButton;
Panel.Body = PanelBody;
Panel.Footer = PanelFooter;
