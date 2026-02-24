import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  type AnimationPhase,
  ContentAnimationContext,
  useContentAnimation,
} from "../ContentAnimation";
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

  const { registerSlot, unregisterSlot } = context;

  // Track content switching state - use ref for synchronous checks in effects
  const prevContentKeyRef = useRef(contentKey);
  const isSwitchingRef = useRef(false);
  const prevVisibleRef = useRef(visible);
  const [isContentSwitching, setIsContentSwitching] = useState(false);
  const [displayedContent, setDisplayedContent] = useState(children);

  // Animation phase tracking for ContentAnimationContext
  const [phase, setPhase] = useState<AnimationPhase>(visible ? "settled" : "hidden");

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
    const keyChanging =
      prevContentKeyRef.current !== contentKey && prevContentKeyRef.current && contentKey;

    if (!isSwitchingRef.current && !isClosing && !keyChanging && visible) {
      setDisplayedContent(children);
    }
  }, [children, visible, contentKey]);

  // Track visibility transitions for animation phase
  useEffect(() => {
    // Skip if we're in content-switching mode (handled separately)
    if (isSwitchingRef.current) return;

    // Capture previous value BEFORE updating the ref to avoid race condition
    // (Two effects on [visible] would update ref before check runs)
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;

    // Skip if visibility hasn't actually changed (initial mount)
    if (wasVisible === visible) return;

    if (visible) {
      // Opening: entering → settled after animation duration
      setPhase("entering");
      const timer = setTimeout(() => {
        setPhase("settled");
      }, ANIMATION_CONFIG.duration * 1000);
      return () => clearTimeout(timer);
    } else {
      // Closing: mark as exiting (content cleanup handled by transitionend)
      setPhase("exiting");
    }
  }, [visible]);

  // Cleanup content when fade-out transition completes
  const handleTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    // Only handle opacity transitions on the direct target (not bubbled events)
    if (e.propertyName === "opacity" && e.target === e.currentTarget && !visible) {
      setDisplayedContent(null);
    }
  };

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
  // Phase is "entering" throughout the close-then-open animation. While semantically
  // imprecise (slot collapses before expanding), this simplifies the logic and
  // useContentSettled() only needs to know "animation in progress" vs "settled".
  useEffect(() => {
    const prevKey = prevContentKeyRef.current;
    const currKey = contentKey;

    // Only trigger close-then-open if:
    // - Slot is visible
    // - Both keys are truthy (actual content, not just showing/hiding)
    // - Keys are different
    if (visible && prevKey && currKey && prevKey !== currKey) {
      // Mark switching immediately (ref updates synchronously)
      setPhase("entering");
      isSwitchingRef.current = true;
      setIsContentSwitching(true);

      // After collapse animation, update content and expand
      const timer = setTimeout(() => {
        // Use ref to get latest children at the time of expand
        setDisplayedContent(childrenRef.current);
        setIsContentSwitching(false);
        isSwitchingRef.current = false;
        setPhase("settled");
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

  // Merge parent animation state with this slot's phase
  const parentAnimation = useContentAnimation();
  const mergedState = useMemo(() => {
    const phases = { ...parentAnimation.phases };
    phases[id] = phase;
    return { phases };
  }, [parentAnimation, id, phase]);

  // Visual styling classes (shadow, rounded corners, background) - skip if plain
  const visualClasses = plain ? "" : "shadow-panel rounded-panel bg-surface";

  // When plain, reset PanelContainerContext so Panels inside render their own shadows
  const content = <div className="flex-1 min-h-0 flex flex-col">{displayedContent}</div>;

  return (
    <div
      className="h-full min-w-0 min-h-0 flex flex-col"
      style={{
        opacity: shouldShowContent ? 1 : 0,
        pointerEvents: shouldShowContent ? "auto" : "none",
        transition: `opacity ${ANIMATION_CONFIG.duration * 0.5}s ease-out`,
        zIndex: shouldShowContent ? 1 : 0,
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {/* Visual wrapper: shadow, rounded corners, background */}
      <div className={`flex-1 min-h-0 flex flex-col ${visualClasses} ${className}`}>
        {plain ? (
          <PanelContainerContext.Provider value={{ inContainer: false }}>
            <ContentAnimationContext.Provider value={mergedState}>
              {content}
            </ContentAnimationContext.Provider>
          </PanelContainerContext.Provider>
        ) : (
          <ContentAnimationContext.Provider value={mergedState}>
            {content}
          </ContentAnimationContext.Provider>
        )}
      </div>
    </div>
  );
}
