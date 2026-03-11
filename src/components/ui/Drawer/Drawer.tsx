// Slide-in drawer panel anchored to the right edge of its positioned container.
//
// Starts below the FeedHeader (top-11 on desktop, top-[92px] on mobile for the two-row header).
// On desktop, the 240px feed strip on the left remains interactive behind the drawer.
// On mobile, the drawer covers the full viewport width below the header.
//
// A close button (X icon) is rendered in the top-right corner for touch accessibility.
// Swiping from the left screen edge (0-20px) rightward closes the drawer on mobile.
//
// The outer div is a permanent clipping container at the target dimensions.
// The inner panel uses a CSS keyframe animation (not a JS-driven transition) so
// the slide-in fires reliably on mount without any JS timing tricks.
// Parent controls mounting/unmounting — there is no open/close animation on exit.

import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useIsMobile } from "../../../hooks/useIsMobile";

interface DrawerProps {
  onClose: () => void;
  disableEscape?: boolean;
  children?: ReactNode;
}

export function Drawer({ onClose, disableEscape = false, children }: DrawerProps) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef({ startX: 0, startTime: 0, tracking: false });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape" && !disableEscape) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, disableEscape]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isMobile) return;
      const x = e.touches[0].clientX;
      if (x > 20) return; // Only screen edge
      touchRef.current = { startX: x, startTime: Date.now(), tracking: true };
    },
    [isMobile],
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current.tracking) return;
    const deltaX = Math.max(0, e.touches[0].clientX - touchRef.current.startX);
    if (panelRef.current) {
      panelRef.current.style.transform = `translateX(${deltaX}px)`;
      panelRef.current.style.transition = "none";
    }
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current.tracking) return;
      touchRef.current.tracking = false;
      const endX = e.changedTouches[0].clientX;
      const deltaX = endX - touchRef.current.startX;
      const elapsed = Date.now() - touchRef.current.startTime;
      const velocity = deltaX / elapsed;

      if (deltaX > window.innerWidth * 0.3 || velocity > 0.5) {
        onClose();
      } else if (panelRef.current) {
        panelRef.current.style.transition = "transform 0.2s ease-out";
        panelRef.current.style.transform = "translateX(0)";
      }
    },
    [onClose],
  );

  return (
    // Clipping container: always occupies the target area, clips the slide animation.
    <div
      className={`absolute ${isMobile ? "top-[92px]" : "top-11"} ${isMobile ? "left-0" : "left-60"} right-0 bottom-0 z-30 overflow-hidden`}
    >
      <div
        ref={panelRef}
        className="absolute inset-0 bg-surface border-l border-border animate-drawer-in"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Close drawer"
          >
            <X size={16} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
