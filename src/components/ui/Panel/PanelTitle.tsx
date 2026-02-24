/**
 * Panel.Title - Styled heading within Panel.Header.
 */

import type { ReactNode } from "react";

interface PanelTitleProps {
  children: ReactNode;
  className?: string;
}

export function PanelTitle({ children, className = "" }: PanelTitleProps) {
  return (
    <h2 className={`font-heading font-semibold text-lg text-text-primary ${className}`}>
      {children}
    </h2>
  );
}
