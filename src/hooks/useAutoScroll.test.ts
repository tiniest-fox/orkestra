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
  let _clientHeight = props.clientHeight ?? 500;
  Object.defineProperty(container, "clientHeight", {
    get: () => _clientHeight,
    set: (value: number) => {
      _clientHeight = value;
    },
  });

  return container;
}

// Trigger a DOM mutation to fire the MutationObserver
// Returns a promise that resolves after the microtask queue is flushed
async function triggerMutationAndFlush(container: HTMLDivElement): Promise<void> {
  const child = document.createElement("div");
  container.appendChild(child);
  // Flush microtasks to ensure MutationObserver callback runs
  await Promise.resolve();
}

let resizeCallback: ResizeObserverCallback | null = null;

describe("useAutoScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseContentSettled.mockReturnValue(true);
    resizeCallback = null;
    // jsdom does not implement ResizeObserver — stub it with a class that captures
    // the callback so tests can fire it. Arrow functions cannot be used as constructors,
    // and vi.fn() in Vitest's SSR transform has the same issue.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          resizeCallback = cb;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe("initial baseline", () => {
    it("initializes lastScrollTop from container's actual scrollTop", async () => {
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
      await triggerMutationAndFlush(container);
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
    it("disables auto-scroll when scrolling up", async () => {
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
      await triggerMutationAndFlush(container);
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(50);
    });

    it("re-enables auto-scroll when scrolling down AND near bottom", async () => {
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
      await triggerMutationAndFlush(container);
      await act(async () => {
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
      await triggerMutationAndFlush(container);
      await act(async () => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });

    it("does NOT re-enable auto-scroll when scrolling down but NOT near bottom", async () => {
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
      await triggerMutationAndFlush(container);
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
      await triggerMutationAndFlush(container);
      await act(async () => {
        vi.runAllTimers();
      });
      expect(container.scrollTop).toBe(50);

      // Call resetAutoScroll
      act(() => {
        result.current.resetAutoScroll();
      });

      // Trigger mutation - auto-scroll should now be re-enabled
      await triggerMutationAndFlush(container);
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

  describe("resize-triggered scrolling", () => {
    it("scrolls to bottom when ResizeObserver fires and auto-scroll is enabled", async () => {
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

      // Reset scrollTop to simulate textarea growth shrinking the container
      container.scrollTop = 0;

      // Fire ResizeObserver callback
      act(() => {
        resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
      });

      // Run RAF scheduled by the resize callback
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });
  });

  describe("container remount", () => {
    it("re-enables auto-scroll when a new container mounts after unmount", async () => {
      const container1 = createMockContainer({
        scrollTop: 100,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      // Mount first container
      act(() => {
        result.current.containerRef(container1);
      });
      act(() => {
        vi.runAllTimers();
      });

      // Scroll up to disable auto-scroll
      container1.scrollTop = 50;
      act(() => {
        result.current.handleScroll();
      });

      // Verify auto-scroll is disabled
      await triggerMutationAndFlush(container1);
      act(() => {
        vi.runAllTimers();
      });
      expect(container1.scrollTop).toBe(50);

      // Unmount (tab switch)
      act(() => {
        result.current.containerRef(null);
      });

      // Mount new container (tab switch back)
      const container2 = createMockContainer({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      act(() => {
        result.current.containerRef(container2);
      });

      // Run RAF for initial scroll on new container
      act(() => {
        vi.runAllTimers();
      });

      // Auto-scroll should be re-enabled — new container should scroll to bottom
      expect(container2.scrollTop).toBe(1000);

      // Also verify mutations on the new container trigger scroll
      container2.scrollTop = 0;
      await triggerMutationAndFlush(container2);
      act(() => {
        vi.runAllTimers();
      });
      expect(container2.scrollTop).toBe(1000);
    });
  });

  describe("container resize near bottom", () => {
    it("does not disable auto-scroll when scrollTop decreases but stays near bottom", async () => {
      // Simulates: user is at bottom → sends chat message → textarea shrinks →
      // container grows → browser clamps scrollTop down. This should NOT disable auto-scroll.
      const container = createMockContainer({
        scrollTop: 500, // at bottom (scrollHeight=1000, clientHeight=500)
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(true));

      act(() => {
        result.current.containerRef(container);
      });
      act(() => {
        vi.runAllTimers();
      });

      // Container grows by 50px (textarea shrank), browser clamps scrollTop from 500 to 450
      // scrollHeight stays 1000, clientHeight becomes 550, scrollTop becomes 450
      // 1000 - 450 - 550 = 0, so still at bottom
      (container as unknown as { clientHeight: number }).clientHeight = 550;
      container.scrollTop = 450;
      act(() => {
        result.current.handleScroll();
      });

      // Auto-scroll should still be enabled — trigger mutation and verify scroll to bottom
      await triggerMutationAndFlush(container);
      act(() => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });
  });

  describe("near-bottom threshold", () => {
    it("does not re-enable when 51px from bottom (just outside threshold)", async () => {
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
      await triggerMutationAndFlush(container);
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
      await triggerMutationAndFlush(container);
      await act(async () => {
        vi.runAllTimers();
      });

      expect(container.scrollTop).toBe(1000);
    });
  });
});
