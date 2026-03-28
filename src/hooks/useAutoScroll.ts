/**
 * Hook for managing auto-scroll behavior.
 * Uses MutationObserver to detect DOM changes and scroll after layout completes.
 * Uses scroll direction detection: scrolling UP disables, scrolling DOWN re-enables.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useContentSettled } from "../components/ui/ContentAnimation";

/** Threshold in pixels from bottom to re-enable auto-scroll when scrolling down. */
const NEAR_BOTTOM_THRESHOLD = 50;

interface UseAutoScrollResult<T extends HTMLElement> {
  /** Callback ref to attach to the scroll container. */
  containerRef: (node: T | null) => void;
  /** Handle scroll events to track user position. */
  handleScroll: () => void;
  /** Reset auto-scroll state (re-enable). */
  resetAutoScroll: () => void;
}

export function useAutoScroll<T extends HTMLElement>(
  /** Whether auto-scroll is active (e.g., tab is visible). */
  isActive: boolean,
): UseAutoScrollResult<T> {
  // Track container element with state so effect re-runs when element changes
  const [container, setContainer] = useState<T | null>(null);
  const isAutoScrollEnabledRef = useRef(true);
  const isContentSettled = useContentSettled();
  const lastScrollTopRef = useRef(0);
  const scrollDeferredRef = useRef(false);

  // Callback ref that updates state when container element changes
  const containerRef = useCallback((node: T | null) => {
    setContainer(node);
    scrollDeferredRef.current = false;
    lastScrollTopRef.current = node?.scrollTop ?? 0;
    // Re-enable auto-scroll when a new container mounts (e.g., tab switch)
    if (node) {
      isAutoScrollEnabledRef.current = true;
    }
  }, []);

  // Direction-based scroll detection:
  // - Scrolling UP disables auto-scroll (user wants to read earlier content)
  // - Scrolling DOWN AND near bottom re-enables auto-scroll
  // - Scrolling DOWN but NOT near bottom leaves state unchanged (user is reading)
  const handleScroll = useCallback(() => {
    if (!container) return;

    const currentScrollTop = container.scrollTop;
    const scrolledUp = currentScrollTop < lastScrollTopRef.current;
    const isNearBottom =
      container.scrollHeight - currentScrollTop - container.clientHeight <= NEAR_BOTTOM_THRESHOLD;

    if (scrolledUp) {
      // User scrolled UP - disable auto-scroll
      isAutoScrollEnabledRef.current = false;
    } else if (isNearBottom) {
      // Scrolled DOWN and near bottom - re-enable auto-scroll
      isAutoScrollEnabledRef.current = true;
    }
    // Scrolled DOWN but not near bottom - leave auto-scroll state unchanged

    lastScrollTopRef.current = currentScrollTop;
  }, [container]);

  const resetAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
  }, []);

  // Single source of truth for scroll-to-bottom logic.
  // All guards checked inside callback so RAF executes with current state.
  const performScrollToBottom = useCallback(() => {
    if (isActive && isAutoScrollEnabledRef.current && container) {
      container.scrollTop = container.scrollHeight;
      // Update lastScrollTop so next scroll event has correct baseline
      lastScrollTopRef.current = container.scrollTop;
    }
  }, [isActive, container]);

  // Auto-scroll using MutationObserver and ResizeObserver - fires after DOM mutations
  // and container size changes (e.g., flex sibling grows, shrinking this container).
  // Combined with RAF to ensure scroll happens after layout completes.
  // Defers scrolling when content animations are in progress.
  useEffect(() => {
    if (!container) return;

    let rafId: number | null = null;

    const scheduleScroll = () => {
      // Cancel any pending RAF to avoid queuing multiple scrolls
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      if (!isContentSettled) {
        // Defer scrolling until animation completes
        scrollDeferredRef.current = true;
      } else {
        // Animation complete, scroll immediately
        rafId = requestAnimationFrame(performScrollToBottom);
      }
    };

    const mutationObserver = new MutationObserver(scheduleScroll);
    mutationObserver.observe(container, { childList: true, subtree: true });

    // Observe container resize — fires when flex layout shrinks this container
    // (e.g., textarea sibling grows, reducing this container's height)
    const resizeObserver = new ResizeObserver(scheduleScroll);
    resizeObserver.observe(container);

    // Initial scroll: also check if settled
    if (isContentSettled) {
      rafId = requestAnimationFrame(performScrollToBottom);
    } else {
      scrollDeferredRef.current = true;
    }

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [container, isContentSettled, performScrollToBottom]);

  // Execute deferred scroll when animation completes
  useEffect(() => {
    if (isContentSettled && scrollDeferredRef.current && container) {
      scrollDeferredRef.current = false;
      requestAnimationFrame(performScrollToBottom);
    }
  }, [isContentSettled, container, performScrollToBottom]);

  return {
    containerRef,
    handleScroll,
    resetAutoScroll,
  };
}
