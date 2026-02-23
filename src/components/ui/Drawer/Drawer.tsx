//! Slide-in drawer panel anchored to the right edge of its positioned container.
//!
//! Starts below the FeedHeader (top-11) so the header remains visible.
//! The 240px feed strip on the left remains interactive behind the drawer.
//!
//! The outer div is a permanent clipping container at the target dimensions.
//! The inner panel uses a CSS keyframe animation (not a JS-driven transition) so
//! the slide-in fires reliably on mount without any JS timing tricks.
//! Parent controls mounting/unmounting — there is no open/close animation on exit.

import { type ReactNode, useEffect } from "react";

interface DrawerProps {
  onClose: () => void;
  disableEscape?: boolean;
  children?: ReactNode;
}

export function Drawer({ onClose, disableEscape = false, children }: DrawerProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape" && !disableEscape) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, disableEscape]);

  return (
    // Clipping container: always occupies the target area, clips the slide animation.
    <div className="absolute top-11 left-60 right-0 bottom-0 z-30 overflow-hidden">
      <div className="absolute inset-0 bg-white border-l border-[var(--border)] animate-drawer-in">
        {children}
      </div>
    </div>
  );
}
