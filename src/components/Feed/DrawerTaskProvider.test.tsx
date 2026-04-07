// Drawer-scoped polling guard tests.

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockTransport } from "../../test/mocks/transport";

// Mock useDiff to isolate DrawerTaskProvider's own polling.
vi.mock("../../hooks/useDiff", () => ({
  useDiff: () => ({ diff: null, loading: false, error: null }),
}));

// Mock usePolling to capture the polling callback.
let capturedPollCallback: (() => Promise<void>) | null = null;
vi.mock("../../hooks/usePolling", () => ({
  usePolling: (cb: (() => Promise<void>) | null) => {
    capturedPollCallback = cb;
  },
}));

import type { ReactNode } from "react";
import { DrawerTaskProvider, useDrawerDiff } from "./DrawerTaskProvider";

// Wrapper that renders the provider with a consumer child.
function wrapper({ children }: { children: ReactNode }) {
  return <DrawerTaskProvider taskId="task-1">{children}</DrawerTaskProvider>;
}

describe("DrawerTaskProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedPollCallback = null;
    (mockTransport as { connectionState: string }).connectionState = "connected";
  });

  it("disables branch commits polling when connectionState is disconnected", () => {
    (mockTransport as { connectionState: string }).connectionState = "disconnected";
    renderHook(() => useDrawerDiff(), { wrapper });
    expect(capturedPollCallback).toBeNull();
  });

  it("enables branch commits polling when connectionState is connected", () => {
    (mockTransport as { connectionState: string }).connectionState = "connected";
    renderHook(() => useDrawerDiff(), { wrapper });
    expect(capturedPollCallback).toBeInstanceOf(Function);
  });
});
