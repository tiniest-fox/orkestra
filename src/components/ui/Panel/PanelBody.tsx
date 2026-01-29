/**
 * Panel.Body - Main content area, optionally scrollable.
 */

import type { ReactNode } from "react";

interface PanelBodyProps {
  children: ReactNode;
  className?: string;
  /** Allow body to scroll independently */
  scrollable?: boolean;
}

export function PanelBody({ children, className = "", scrollable = false }: PanelBodyProps) {
  const scrollClasses = scrollable ? "flex-1 overflow-auto" : "";
  return <div className={`p-4 ${scrollClasses} ${className}`}>{children}</div>;
}
