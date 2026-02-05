import { useContext, useEffect, useRef, useState } from "react";
import {
  ANIMATION_CONFIG,
  SlotLayoutContext,
  type SlotProps,
} from "./types";

/**
 * Slot - A slot within PanelLayout that animates open/closed.
 *
 * By default, provides visual container styling (shadow, rounded corners, background).
 * Use `plain` prop to skip styling (for nested PanelLayouts).
 *
 * Content inside should be wrapped in a Panel for overflow clipping during animation.
 *
 * When contentKey changes, the slot closes then reopens with new content.
 */
export function Slot({
  children,
  id,
  type,
  size,
  visible,
  contentKey,
  plain = false,
  className = "",
}: SlotProps) {
  const context = useContext(SlotLayoutContext);
  if (!context) {
    throw new Error("Slot must be used within a PanelLayout");
  }

  const { direction, registerSlot, unregisterSlot } = context;

  // Track content switching state
  const prevContentKeyRef = useRef(contentKey);
  const [isContentSwitching, setIsContentSwitching] = useState(false);
  const [displayedContent, setDisplayedContent] = useState(children);

  // Store children in a ref so we can access latest without retriggering effects
  const childrenRef = useRef(children);
  useEffect(() => {
    childrenRef.current = children;
    // Keep displayed content in sync when not switching
    if (!isContentSwitching) {
      setDisplayedContent(children);
    }
  }, [children, isContentSwitching]);

  // Register/update slot config on prop changes
  // Map.set preserves insertion order for existing keys, so order stays stable
  useEffect(() => {
    registerSlot({
      id,
      type,
      size,
      visible: visible && !isContentSwitching,
    });
  }, [id, type, size, visible, isContentSwitching, registerSlot]);

  // Unregister only on unmount (not on prop changes)
  // This preserves slot order in the Map
  useEffect(() => {
    return () => unregisterSlot(id);
  }, [id, unregisterSlot]);

  // Handle content switching - close then open
  // Note: children NOT in dependency array to avoid race conditions
  useEffect(() => {
    const prevKey = prevContentKeyRef.current;
    const currKey = contentKey;

    // Only trigger close-then-open if:
    // - Slot is visible
    // - Both keys are truthy (actual content, not just showing/hiding)
    // - Keys are different
    if (visible && prevKey && currKey && prevKey !== currKey) {
      // Start collapse phase
      setIsContentSwitching(true);

      // After collapse animation, update content and expand
      const timer = setTimeout(() => {
        // Use ref to get latest children at the time of expand
        setDisplayedContent(childrenRef.current);
        setIsContentSwitching(false);
      }, ANIMATION_CONFIG.duration * 1000);

      prevContentKeyRef.current = currKey;
      return () => clearTimeout(timer);
    }

    prevContentKeyRef.current = currKey;
  }, [contentKey, visible]);

  // Determine if content should be shown
  const shouldShowContent = visible && !isContentSwitching;

  // For fixed slots, render content at full size (prevents squishing during animation)
  const contentStyle: React.CSSProperties = {};
  if (type === "fixed" && size) {
    if (direction === "horizontal") {
      contentStyle.width = size;
    } else {
      contentStyle.height = size;
    }
  }

  // Visual styling classes (shadow, rounded corners, background) - skip if plain
  const visualClasses = plain
    ? ""
    : "shadow-panel rounded-panel bg-white dark:bg-stone-900";

  return (
    <div
      className={`h-full min-w-0 min-h-0 flex flex-col ${visualClasses} ${className}`}
      style={{
        opacity: shouldShowContent ? 1 : 0,
        transition: `opacity ${ANIMATION_CONFIG.duration * 0.5}s ease-out`,
      }}
    >
      {/* Content wrapper - flex-1 to fill, fixed size for fixed slots to prevent squishing */}
      <div className="flex-1 min-h-0 flex flex-col" style={contentStyle}>
        {displayedContent}
      </div>
    </div>
  );
}
