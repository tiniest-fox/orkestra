/**
 * Hook for managing auto-scroll behavior.
 * Tracks whether user is at bottom of scroll container and enables auto-scroll on updates.
 */

import { useCallback, useEffect, useRef } from "react";

interface UseAutoScrollResult<T extends HTMLElement> {
  /** Ref to attach to the scroll container. */
  containerRef: React.RefObject<T>;
  /** Handle scroll events to track user position. */
  handleScroll: () => void;
  /** Reset auto-scroll state (re-enable). */
  resetAutoScroll: () => void;
}

export function useAutoScroll<T extends HTMLElement>(
  /** Dependencies that trigger auto-scroll when changed. */
  dependencies: unknown[],
  /** Whether auto-scroll is active (e.g., tab is visible). */
  isActive: boolean,
): UseAutoScrollResult<T> {
  const containerRef = useRef<T>(null);
  const isAutoScrollEnabledRef = useRef(true);

  // Threshold in pixels - allows for minor scroll jitter
  const SCROLL_THRESHOLD = 30;

  const isAtBottom = useCallback((container: HTMLElement): boolean => {
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= SCROLL_THRESHOLD;
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    isAutoScrollEnabledRef.current = isAtBottom(container);
  }, [isAtBottom]);

  const resetAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
  }, []);

  // Auto-scroll to bottom when dependencies change (only if user is following)
  useEffect(() => {
    if (isActive && containerRef.current && isAutoScrollEnabledRef.current) {
      const container = containerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [...dependencies, isActive]);

  return {
    containerRef,
    handleScroll,
    resetAutoScroll,
  };
}
