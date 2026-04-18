// Tests for useOrchestratorWatchdog: Tauri guard, restart logic, retry cap, and polling gates.

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockTransport, mockTransportCall } from "../test/mocks/transport";
import { useOrchestratorWatchdog } from "./useOrchestratorWatchdog";

// ============================================================================
// Module mocks
// ============================================================================

const mockIsVisible = vi.hoisted(() => ({ value: true }));

vi.mock("./usePageVisibility", () => ({
  usePageVisibility: () => mockIsVisible.value,
}));

// ============================================================================
// Helpers
// ============================================================================

const mockCall = mockTransportCall as ReturnType<typeof vi.fn>;

function stubTauri(statusSequence: Array<{ status: string; pid?: number }>) {
  vi.stubEnv("TAURI_ENV_PLATFORM", "macos");
  let idx = 0;
  mockCall.mockImplementation((method: string) => {
    if (method === "get_orchestrator_status") {
      const res = statusSequence[Math.min(idx++, statusSequence.length - 1)];
      return Promise.resolve(res);
    }
    if (method === "get_project_info") return Promise.resolve({ project_root: "/mock" });
    if (method === "retry_startup") return Promise.resolve(undefined);
    return Promise.reject(new Error(`Unmocked: ${method}`));
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("useOrchestratorWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsVisible.value = true;
    (mockTransport as { connectionState: string }).connectionState = "connected";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("does not call transport when TAURI_ENV_PLATFORM is unset", async () => {
    // No stubTauri — platform env is falsy
    renderHook(() => useOrchestratorWatchdog());
    await vi.advanceTimersByTimeAsync(1);
    expect(mockCall).not.toHaveBeenCalledWith("get_orchestrator_status");
  });

  it("calls retry_startup when status is stale", async () => {
    stubTauri([{ status: "stale" }]);
    renderHook(() => useOrchestratorWatchdog());
    await vi.advanceTimersByTimeAsync(1);
    expect(mockCall).toHaveBeenCalledWith("get_orchestrator_status");
    expect(mockCall).toHaveBeenCalledWith("retry_startup", { path: "/mock" });
  });

  it("calls retry_startup when status is absent", async () => {
    stubTauri([{ status: "absent" }]);
    renderHook(() => useOrchestratorWatchdog());
    await vi.advanceTimersByTimeAsync(1);
    expect(mockCall).toHaveBeenCalledWith("retry_startup", { path: "/mock" });
  });

  it("does not call retry_startup when status is running", async () => {
    stubTauri([{ status: "running" }]);
    renderHook(() => useOrchestratorWatchdog());
    await vi.advanceTimersByTimeAsync(1);
    expect(mockCall).toHaveBeenCalledWith("get_orchestrator_status");
    expect(mockCall).not.toHaveBeenCalledWith("retry_startup", expect.anything());
  });

  it("stops retrying after MAX_RETRIES consecutive failures", async () => {
    stubTauri([{ status: "stale" }]); // always stale
    renderHook(() => useOrchestratorWatchdog());

    // Poll 1 (immediate)
    await vi.advanceTimersByTimeAsync(1);
    // Poll 2 and 3 (10s each)
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);

    const retriesAfter3 = mockCall.mock.calls.filter((c) => c[0] === "retry_startup").length;
    expect(retriesAfter3).toBe(3);

    // Poll 4 — retryCount is at MAX_RETRIES, should not retry
    await vi.advanceTimersByTimeAsync(10_000);
    const retriesAfter4 = mockCall.mock.calls.filter((c) => c[0] === "retry_startup").length;
    expect(retriesAfter4).toBe(3);
  });

  it("resets retry count when status returns to running", async () => {
    stubTauri([{ status: "stale" }, { status: "running" }, { status: "stale" }]);
    renderHook(() => useOrchestratorWatchdog());

    // Poll 1: stale → retry (count becomes 1)
    await vi.advanceTimersByTimeAsync(1);
    // Poll 2: running → reset (count becomes 0)
    await vi.advanceTimersByTimeAsync(10_000);
    // Poll 3: stale → retry again (count becomes 1, not blocked)
    await vi.advanceTimersByTimeAsync(10_000);

    const retryCalls = mockCall.mock.calls.filter((c) => c[0] === "retry_startup").length;
    expect(retryCalls).toBe(2); // polls 1 and 3
  });

  it("does not poll when connectionState is not connected", async () => {
    stubTauri([{ status: "stale" }]);
    (mockTransport as { connectionState: string }).connectionState = "disconnected";
    renderHook(() => useOrchestratorWatchdog());
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockCall).not.toHaveBeenCalledWith("get_orchestrator_status");
  });

  it("does not poll when page is hidden", async () => {
    stubTauri([{ status: "stale" }]);
    mockIsVisible.value = false;
    renderHook(() => useOrchestratorWatchdog());
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockCall).not.toHaveBeenCalledWith("get_orchestrator_status");
  });
});
