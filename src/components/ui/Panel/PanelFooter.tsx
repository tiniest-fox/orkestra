/**
 * Panel.Footer - Fixed footer section.
 */

import type { ReactNode } from "react";

interface PanelFooterProps {
  children: ReactNode;
  className?: string;
}

export function PanelFooter({ children, className = "" }: PanelFooterProps) {
  return <div className={`flex-shrink-0 px-4 py-3 ${className}`}>{children}</div>;
}
