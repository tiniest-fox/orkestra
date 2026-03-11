// Shared footer bar container — consistent height, padding, and border.

import type { ReactNode } from "react";

export function FooterBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`shrink-0 px-6 border-t border-border flex items-center gap-2.5 min-h-[52px] pb-[env(safe-area-inset-bottom)] ${className}`}
    >
      {children}
    </div>
  );
}
