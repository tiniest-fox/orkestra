// Shared footer bar container — consistent height, padding, and border.
// Use paddedBottom for flex-col variants (reject, update) so the bottom
// padding is at least 12px even when safe-area-inset-bottom is 0.

import type { ReactNode } from "react";
import { useIsMobile } from "../../../../hooks/useIsMobile";

export function FooterBar({
  children,
  className = "",
  paddedBottom = false,
}: {
  children: ReactNode;
  className?: string;
  /** Ensures ≥12px bottom padding — use for flex-col footers with textarea+buttons. */
  paddedBottom?: boolean;
}) {
  const isMobile = useIsMobile();
  const pbClass = paddedBottom
    ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    : "pb-[env(safe-area-inset-bottom)]";
  return (
    <div
      className={`shrink-0 border-t border-border flex items-center gap-2.5 min-h-[52px] ${pbClass} ${isMobile ? "px-4 [&>button]:flex-1 [&>button]:justify-center" : "px-6"} ${className}`}
    >
      {children}
    </div>
  );
}
