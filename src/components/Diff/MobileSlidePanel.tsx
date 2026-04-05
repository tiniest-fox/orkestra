// Mobile-only slide-in panel with backdrop dismiss.

import type React from "react";

interface MobileSlidePanelProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}

export function MobileSlidePanel({ open, onClose, ariaLabel, children }: MobileSlidePanelProps) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        className="absolute inset-0 z-20"
        onClick={onClose}
        onKeyDown={() => {}}
      />
      <div className="absolute top-0 left-0 bottom-0 w-64 z-30 bg-surface border-r border-border shadow-xl overflow-y-auto">
        {children}
      </div>
    </>
  );
}
