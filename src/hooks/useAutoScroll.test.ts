import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock useContentSettled before importing the hook
vi.mock("../components/ui/ContentAnimation", () => ({
  useContentSettled: vi.fn(() => true),
}));

import { useContentSettled } from "../components/ui/ContentAnimation";
import { useAutoScroll } from "./useAutoScroll";

const mockUseContentSettled = useContentSettled as ReturnType<typeof vi.fn>;

// Create a mock container element with controllable scroll properties
function createMockContainer(
  props: { scrollTop?: number; scrollHeight?: number; clientHeight?: number } = {},
): HTMLDivElement {
  const container = document.createElement("div");

  // Override properties with getters/setters for control
  let _scrollTop = props.scrollTop ?? 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => _scrollTop,
    set: (value: number) => {
      _scrollTop = value;
    },
  });
  Object.defineProperty(container, "scrollHeight", {
    get: () => props.scrollHeight ?? 1000,
  });
  Object.defineProperty(container, "clientHeight", {
    get: () => props.clientHeight ?? 500,
  });

  return container;
}

// Trigger a DOM mutation to fire the MutationObserver
function triggerMutation(container: HTMLDivElement) {
  const child = document.createElement("div");
  container.appendChild(child);
}

describe("useAutoScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseContentSettled.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("initial baseline", () => {
    it("initializes lastScrollTop from container's actual scrollTop", () => {
      // This test verifies the bug fix: with the old code, baseline was hardcoded to 0,
      // so scrolling from 100 to 50 would be detected as "scrolling up" (50 < 0 is false,
      // so it would be "scrolling down"). With the fix, baseline is 100, so 50 < 100 is
      // correctly detected as scrolling up.
      const container = createMockContainer({
        scrollTop: 100,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run initial RAF to complete setup
      act(() => {
        vi.runAllTimers();
      });

      // Scroll from 100 to 50 - this is scrolling UP from the correct baseline of 100
      container.scrollTop = 50;
      act(() => {
        result.current.handleScroll();
      });

      // Auto-scroll should be disabled because we scrolled up
      // Verify by triggering mutation - scrollTop should NOT be set to scrollHeight
      triggerMutation(container);
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(50); // Should stay at 50, not jump to 1000
    });

    it("uses 0 as baseline when container is null", () => {
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      // Call containerRef with null
      act(() => {
        result.current.containerRef(null);
      });

      // No error should be thrown
      expect(() => result.current.handleScroll()).not.toThrow();
    });
  });

  describe("scroll direction detection", () => {
    it("disables auto-scroll when scrolling up", () => {
      const container = createMockContainer({
        scrollTop: 100,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run initial RAF
      act(() => {
        vi.runAllTimers();
      });

      // Scroll up from 100 to 50
      container.scrollTop = 50;
      act(() => {
        result.current.handleScroll();
      });

      // Trigger mutation - auto-scroll should be disabled, so scrollTop stays at 50
      triggerMutation(container);
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(50);
    });

    it("re-enables auto-scroll when scrolling down AND near bottom", () => {
      const container = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run initial RAF
      act(() => {
        vi.runAllTimers();
      });

      // Scroll up to disable auto-scroll
      container.scrollTop = 100;
      act(() => {
        result.current.handleScroll();
      });
      container.scrollTop = 50;
      act(() => {
        result.current.handleScroll();
      });

      // Verify auto-scroll is disabled
      triggerMutation(container);
      act(() => {
        vi.runAllTimers();
      });
      expect(container.scrollTop).toBe(50);

      // Now scroll down to near bottom (within 50px of max scroll position 500)
      // Max scroll = scrollHeight - clientHeight = 1000 - 500 = 500
      // Near bottom = within 50px of that, so scrollTop >= 450
      container.scrollTop = 455;
      act(() => {
        result.current.handleScroll();
      });

      // Trigger mutation - auto-scroll should be re-enabled, so scrollTop jumps to scrollHeight
      triggerMutation(container);
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });

    it("does NOT re-enable auto-scroll when scrolling down but NOT near bottom", () => {
      const container = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run initial RAF
      act(() => {
        vi.runAllTimers();
      });

      // Scroll up to disable auto-scroll
      container.scrollTop = 100;
      act(() => {
        result.current.handleScroll();
      });
      container.scrollTop = 50;
      act(() => {
        result.current.handleScroll();
      });

      // Scroll down but NOT near bottom (200 is far from 500 max)
      container.scrollTop = 200;
      act(() => {
        result.current.handleScroll();
      });

      // Trigger mutation - auto-scroll should still be disabled
      triggerMutation(container);
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(200); // Should stay at 200, not jump to 1000
    });
  });

  describe("resetAutoScroll", () => {
    it("re-enables auto-scroll after being disabled", async () => {
      const container = createMockContainer({
        scrollTop: 100,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run initial RAF
      await act(async () => {
        vi.runAllTimers();
      });

      // Scroll up to disable
      container.scrollTop = 50;
      act(() => {
        result.current.handleScroll();
      });

      // Verify auto-scroll is disabled
      triggerMutation(container);
      await act(async () => {
        vi.runAllTimers();
      });
      expect(container.scrollTop).toBe(50);

      // Call resetAutoScroll
      act(() => {
        result.current.resetAutoScroll();
      });

      // Trigger mutation - auto-scroll should now be re-enabled
      triggerMutation(container);
      await act(async () => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });
  });

  describe("deferred scroll", () => {
    it("defers scroll when content is not settled", () => {
      mockUseContentSettled.mockReturnValue(false);

      const container = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result, rerender } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run timers - scroll should NOT happen because content is not settled
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(0);

      // Now settle the content
      mockUseContentSettled.mockReturnValue(true);
      rerender();

      // After RAF, scroll should happen
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });

    it("executes deferred scroll when content becomes settled", () => {
      mockUseContentSettled.mockReturnValue(false);

      const container = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result, rerender } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Scroll should be deferred
      act(() => {
        vi.runAllTimers();
      });
      expect(container.scrollTop).toBe(0);

      // Settle content
      mockUseContentSettled.mockReturnValue(true);
      rerender();

      // Advance timers to execute RAF
      act(() => {
        vi.runAllTimers();
      });

      // Now scroll should have happened
      expect(container.scrollTop).toBe(1000);
    });
  });

  describe("isActive", () => {
    it("does not scroll when isActive is false", () => {
      const container = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(false));

      act(() => {
        result.current.containerRef(container);
      });

      // Run timers
      act(() => {
        vi.runAllTimers();
      });

      // Scroll should not have happened because isActive is false
      expect(container.scrollTop).toBe(0);
    });

    it("scrolls when isActive is true", () => {
      const container = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run timers for RAF
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });
  });

  describe("near-bottom threshold", () => {
    it("does not re-enable when 51px from bottom (just outside threshold)", () => {
      const container = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run initial RAF
      act(() => {
        vi.runAllTimers();
      });

      // Disable auto-scroll by scrolling up
      container.scrollTop = 100;
      act(() => {
        result.current.handleScroll();
      });
      container.scrollTop = 50;
      act(() => {
        result.current.handleScroll();
      });

      // Max scroll position = 1000 - 500 = 500
      // Near bottom threshold = 50px, so anything >= 450 is "near bottom"

      // Scroll to 449 (just outside threshold - 51px from bottom)
      container.scrollTop = 449;
      act(() => {
        result.current.handleScroll();
      });

      // Trigger mutation - should still be disabled (51px from bottom)
      triggerMutation(container);
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(449);
    });

    it("re-enables when exactly 50px from bottom (at threshold)", async () => {
      const container = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });

      // Run initial RAF
      await act(async () => {
        vi.runAllTimers();
      });

      // Disable auto-scroll by scrolling up
      container.scrollTop = 100;
      act(() => {
        result.current.handleScroll();
      });
      container.scrollTop = 50;
      act(() => {
        result.current.handleScroll();
      });

      // Scroll to 450 (exactly at threshold - 50px from bottom)
      container.scrollTop = 450;
      act(() => {
        result.current.handleScroll();
      });

      // Trigger mutation - should be re-enabled (at threshold)
      triggerMutation(container);
      await act(async () => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });
  });
});
