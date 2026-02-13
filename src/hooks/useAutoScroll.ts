/**
 * Hook for managing auto-scroll behavior.
 * Uses MutationObserver to detect DOM changes and scroll after layout completes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

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

  // Callback ref that updates state when container element changes
  const containerRef = useCallback((node: T | null) => setContainer(node), []);

  // Threshold in pixels - allows for minor scroll jitter
  const SCROLL_THRESHOLD = 30;

  const isAtBottom = useCallback((el: HTMLElement): boolean => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= SCROLL_THRESHOLD;
  }, []);

  const handleScroll = useCallback(() => {
    if (!container) return;
    isAutoScrollEnabledRef.current = isAtBottom(container);
  }, [container, isAtBottom]);

  const resetAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
  }, []);

  // Auto-scroll using MutationObserver - fires after DOM mutations
  // Combined with RAF to ensure scroll happens after layout completes
  useEffect(() => {
    if (!container) return;

    let rafId: number | null = null;

    const scrollToBottom = () => {
      if (isActive && isAutoScrollEnabledRef.current && container) {
        container.scrollTop = container.scrollHeight;
      }
    };

    const observer = new MutationObserver(() => {
      // Cancel any pending RAF to avoid queuing multiple scrolls
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      // Schedule scroll after layout completes
      rafId = requestAnimationFrame(scrollToBottom);
    });

    observer.observe(container, { childList: true, subtree: true });

    // Initial scroll for content already present when observer connects
    rafId = requestAnimationFrame(scrollToBottom);

    return () => {
      observer.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isActive, container]);

  return {
    containerRef,
    handleScroll,
    resetAutoScroll,
  };
}
