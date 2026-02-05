import { useContext, useEffect, useRef, useState } from "react";
import {
  ANIMATION_CONFIG,
  PanelContainerContext,
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

  // Track content switching state - use ref for synchronous checks in effects
  const prevContentKeyRef = useRef(contentKey);
  const isSwitchingRef = useRef(false);
  const prevVisibleRef = useRef(visible);
  const [isContentSwitching, setIsContentSwitching] = useState(false);
  const [displayedContent, setDisplayedContent] = useState(children);

  // Store children in a ref so we can access latest without retriggering effects
  const childrenRef = useRef(children);
  useEffect(() => {
    childrenRef.current = children;
  }, [children]);

  // Keep displayed content in sync - but only when appropriate
  useEffect(() => {
    // Don't update content if:
    // 1. We're in the middle of a content switch (wait for switch to complete)
    // 2. We're closing (keep old content visible during close animation)
    // 3. contentKey is changing (let the switch effect handle it)
    const isClosing = prevVisibleRef.current && !visible;
    const keyChanging = prevContentKeyRef.current !== contentKey &&
                        prevContentKeyRef.current && contentKey;

    if (!isSwitchingRef.current && !isClosing && !keyChanging && visible) {
      setDisplayedContent(children);
    }
  }, [children, visible, contentKey]);

  // Track visibility changes
  useEffect(() => {
    prevVisibleRef.current = visible;
  }, [visible]);

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
  useEffect(() => {
    const prevKey = prevContentKeyRef.current;
    const currKey = contentKey;

    // Only trigger close-then-open if:
    // - Slot is visible
    // - Both keys are truthy (actual content, not just showing/hiding)
    // - Keys are different
    if (visible && prevKey && currKey && prevKey !== currKey) {
      // Mark switching immediately (ref updates synchronously)
      isSwitchingRef.current = true;
      setIsContentSwitching(true);

      // After collapse animation, update content and expand
      const timer = setTimeout(() => {
        // Use ref to get latest children at the time of expand
        setDisplayedContent(childrenRef.current);
        setIsContentSwitching(false);
        isSwitchingRef.current = false;
      }, ANIMATION_CONFIG.duration * 1000);

      prevContentKeyRef.current = currKey;
      return () => {
        clearTimeout(timer);
        isSwitchingRef.current = false;
      };
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

  // When plain, reset PanelContainerContext so Panels inside render their own shadows
  const content = (
    <div className="flex-1 min-h-0 flex flex-col" style={contentStyle}>
      {displayedContent}
    </div>
  );

  return (
    <div
      className="h-full min-w-0 min-h-0 flex flex-col"
      style={{
        opacity: shouldShowContent ? 1 : 0,
        pointerEvents: shouldShowContent ? "auto" : "none",
        transition: `opacity ${ANIMATION_CONFIG.duration * 0.5}s ease-out`,
      }}
    >
      {/* Visual wrapper: shadow, rounded corners, background */}
      <div className={`flex-1 min-h-0 flex flex-col ${visualClasses} ${className}`}>
        {plain ? (
          <PanelContainerContext.Provider value={{ inContainer: false }}>
            {content}
          </PanelContainerContext.Provider>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
