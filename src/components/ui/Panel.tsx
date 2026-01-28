/**
 * Panel - Base container component with visual styling.
 * Features 12px border radius, drop shadow, and optional Header/Body/Footer subcomponents.
 */

import type { ReactNode } from "react";

type PanelVariant = "default" | "elevated";

interface PanelProps {
  children: ReactNode;
  variant?: PanelVariant;
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

/**
 * Panel root component - container with rounded corners and shadow.
 */
export function Panel({ children, variant = "default", className = "" }: PanelProps) {
  return (
    <div
      className={`bg-white rounded-panel ${variantStyles[variant]} flex flex-col overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Panel.Header - Fixed header section with border divider.
 */
function PanelHeader({ children, className = "" }: PanelHeaderProps) {
  return (
    <div
      className={`flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-stone-200 ${className}`}
    >
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
 * Panel.Footer - Fixed footer section with top border.
 */
function PanelFooter({ children, className = "" }: PanelFooterProps) {
  return (
    <div className={`flex-shrink-0 px-4 py-3 border-t border-stone-200 ${className}`}>
      {children}
    </div>
  );
}

// Attach subcomponents to Panel
Panel.Header = PanelHeader;
Panel.Title = PanelTitle;
Panel.CloseButton = PanelCloseButton;
Panel.Body = PanelBody;
Panel.Footer = PanelFooter;
