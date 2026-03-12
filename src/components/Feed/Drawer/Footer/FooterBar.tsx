// Shared footer bar container — consistent height, padding, and border.
// Safe-area-inset-bottom is handled by the Drawer panel, not here.

import type { ReactNode } from "react";
import { useIsMobile } from "../../../../hooks/useIsMobile";

export function FooterBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  return (
    <div
      className={`shrink-0 border-t border-border flex items-center gap-2.5 min-h-[52px] ${isMobile ? "px-4 [&>button]:flex-1 [&>button]:justify-center" : "px-6"} ${className}`}
    >
      {children}
    </div>
  );
}
