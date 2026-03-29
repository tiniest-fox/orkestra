// Tests for the ReconnectingBanner grace period behavior.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "../transport/types";

// AnimatePresence keeps exit-animated children in the DOM until the animation completes.
// In jsdom, requestAnimationFrame isn't faked, so exit animations never finish and
// elements never leave the DOM. Replace with pass-through wrappers for deterministic tests.
vi.mock("framer-motion", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test-only pass-through mock
  AnimatePresence: ({ children }: { children: any }) => children ?? null,
  motion: {
    // biome-ignore lint/suspicious/noExplicitAny: test-only pass-through mock
    div: ({ children, className }: { children: any; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  },
}));

// ============================================================================
// Reactive mock for useConnectionState
// ============================================================================
//
// The global setup mocks useConnectionState as a static getter, which doesn't
// trigger re-renders on state transitions. This file-level mock overrides it
// with a React.useState-backed version so state changes cause re-renders.

// Module-level setter, updated on each render of useConnectionState.
let _setConnectionState: ((state: ConnectionState) => void) | null = null;

vi.mock("../transport", async () => {
  const React = await import("react");
  return {
    useConnectionState: () => {
      const [state, setState] = React.useState<ConnectionState>("connected");
      _setConnectionState = setState;
      return state;
    },
  };
});

function setConnectionState(state: ConnectionState): void {
  act(() => {
    _setConnectionState?.(state);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("ReconnectingBanner", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    _setConnectionState = null;

    // Import lazily so the mock is registered before the module resolves.
    const { ReconnectingBanner } = await import("./ReconnectingBanner");
    render(<ReconnectingBanner />);
    // Flush initial render effects.
    act(() => vi.advanceTimersByTime(0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("does not show banner within 2s of disconnect", () => {
    setConnectionState("disconnected");
    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("shows banner after 2s of continuous disconnection", () => {
    setConnectionState("disconnected");
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  });

  it("banner disappears when connection is restored", () => {
    setConnectionState("disconnected");
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();

    setConnectionState("connected");
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("cancels banner timer if reconnect happens before 2s", () => {
    setConnectionState("disconnected");
    act(() => vi.advanceTimersByTime(1_000)); // halfway through grace period

    // Reconnect before the timer fires
    setConnectionState("connected");

    // Advance past what would have been the timer expiry
    act(() => vi.advanceTimersByTime(1_500));
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("does not show banner when staying connected", () => {
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });
});
