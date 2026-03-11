// Tests for usePageVisibility: initial state, reactive updates, and cleanup.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageVisibility } from "./usePageVisibility";

// ============================================================================
// visibilityState mock
// ============================================================================

type VisibilityHandler = () => void;

let listeners: VisibilityHandler[];

beforeEach(() => {
  listeners = [];

  vi.spyOn(document, "addEventListener").mockImplementation(
    (type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === "visibilitychange") {
        listeners.push(handler as VisibilityHandler);
      }
    },
  );

  vi.spyOn(document, "removeEventListener").mockImplementation(
    (type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === "visibilitychange") {
        const idx = listeners.indexOf(handler as VisibilityHandler);
        if (idx !== -1) listeners.splice(idx, 1);
      }
    },
  );

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function triggerVisibilityChange(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  for (const h of listeners) h();
}

// ============================================================================
// Tests
// ============================================================================

describe("usePageVisibility", () => {
  it("returns true when page is visible", () => {
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);
  });

  it("returns false when page starts hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(false);
  });

  it("updates to false when page becomes hidden", async () => {
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);

    await act(async () => {
      triggerVisibilityChange("hidden");
    });
    expect(result.current).toBe(false);
  });

  it("updates to true when page becomes visible again", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(false);

    await act(async () => {
      triggerVisibilityChange("visible");
    });
    expect(result.current).toBe(true);
  });

  it("removes the event listener on unmount", () => {
    const { unmount } = renderHook(() => usePageVisibility());
    expect(listeners).toHaveLength(1);
    unmount();
    expect(listeners).toHaveLength(0);
  });
});
