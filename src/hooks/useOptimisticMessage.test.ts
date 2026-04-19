// Tests for useOptimisticMessage: clearing behavior on logs update and errors.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOptimisticMessage } from "./useOptimisticMessage";

// Stable reference — prevents the logs-clearing useEffect from firing on every re-render.
const EMPTY_LOGS: unknown[] = [];

describe("useOptimisticMessage", () => {
  it("starts with null optimisticMessage and zero scrollTrigger", () => {
    const { result } = renderHook(() => useOptimisticMessage(EMPTY_LOGS));
    expect(result.current.optimisticMessage).toBeNull();
    expect(result.current.scrollTrigger).toBe(0);
  });

  it("clears optimisticMessage when logs reference changes", () => {
    const initialLogs: unknown[] = [];
    const { result, rerender } = renderHook(({ l }) => useOptimisticMessage(l), {
      initialProps: { l: initialLogs },
    });

    act(() => {
      result.current.setOptimisticMessage("hello");
    });
    expect(result.current.optimisticMessage).toBe("hello");

    // New logs reference simulates real server data arriving.
    rerender({ l: [{ type: "text" }] });
    expect(result.current.optimisticMessage).toBeNull();
  });

  it("clears optimisticMessage when error becomes non-null", () => {
    const { result, rerender } = renderHook(
      ({ error }) => useOptimisticMessage(EMPTY_LOGS, error),
      { initialProps: { error: null as unknown } },
    );

    act(() => {
      result.current.setOptimisticMessage("pending");
    });
    expect(result.current.optimisticMessage).toBe("pending");

    rerender({ error: "network error" });
    expect(result.current.optimisticMessage).toBeNull();
  });

  it("does not clear optimisticMessage when error remains null", () => {
    const { result, rerender } = renderHook(
      ({ error }) => useOptimisticMessage(EMPTY_LOGS, error),
      { initialProps: { error: null as unknown } },
    );

    act(() => {
      result.current.setOptimisticMessage("pending");
    });
    rerender({ error: null });
    expect(result.current.optimisticMessage).toBe("pending");
  });

  it("triggerScroll increments scrollTrigger each call", () => {
    const { result } = renderHook(() => useOptimisticMessage(EMPTY_LOGS));
    act(() => {
      result.current.triggerScroll();
    });
    expect(result.current.scrollTrigger).toBe(1);
    act(() => {
      result.current.triggerScroll();
    });
    expect(result.current.scrollTrigger).toBe(2);
  });
});
