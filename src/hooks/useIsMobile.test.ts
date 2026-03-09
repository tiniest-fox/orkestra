//! Tests for useIsMobile: initial state, reactive updates, and cleanup.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// matchMedia mock
// ============================================================================

type ChangeHandler = (e: MediaQueryListEvent) => void;

interface MockMql {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _trigger: (matches: boolean) => void;
}

let mockMql: MockMql;

beforeEach(() => {
  const listeners: ChangeHandler[] = [];
  mockMql = {
    matches: false,
    addEventListener: vi.fn((_type: string, handler: ChangeHandler) => {
      listeners.push(handler);
    }),
    removeEventListener: vi.fn((_type: string, handler: ChangeHandler) => {
      const idx = listeners.indexOf(handler);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    _trigger: (matches: boolean) => {
      mockMql.matches = matches;
      for (const h of listeners) h({ matches } as MediaQueryListEvent);
    },
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => mockMql),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

import { useIsMobile } from "./useIsMobile";

describe("useIsMobile", () => {
  it("returns false when matchMedia reports no match (desktop)", () => {
    mockMql.matches = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("returns true when matchMedia reports a match (mobile)", () => {
    mockMql.matches = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("reactively updates when the change event fires", async () => {
    mockMql.matches = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    await act(async () => {
      mockMql._trigger(true);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      mockMql._trigger(false);
    });
    expect(result.current).toBe(false);
  });

  it("removes the event listener on unmount", () => {
    const { unmount } = renderHook(() => useIsMobile());
    expect(mockMql.addEventListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockMql.removeEventListener).toHaveBeenCalledTimes(1);
    expect(mockMql.removeEventListener.mock.calls[0][0]).toBe("change");
  });
});
