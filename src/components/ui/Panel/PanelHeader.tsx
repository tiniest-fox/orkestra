/**
 * Panel.Header - Fixed header section.
 */

import type { ReactNode } from "react";

interface PanelHeaderProps {
  children: ReactNode;
  className?: string;
}

export function PanelHeader({ children, className = "" }: PanelHeaderProps) {
  return (
    <div className={`flex-shrink-0 flex items-center justify-between px-4 py-3 ${className}`}>
      {children}
    </div>
  );
}
