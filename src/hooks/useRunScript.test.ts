//! Tests for the useRunScript hook: initial state, taskId reset, and error handling.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockTransportCall } from "../test/mocks/transport";
import { useRunScript } from "./useRunScript";

// Global setup (setup.ts) already calls resetTransportMocks() in beforeEach.

afterEach(() => {
  vi.useRealTimers();
});

describe("useRunScript", () => {
  it("starts with stopped status and empty lines", () => {
    const { result } = renderHook(() => useRunScript("task-1", false));
    expect(result.current.status.running).toBe(false);
    expect(result.current.lines).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("resets state when taskId changes", async () => {
    const { result, rerender } = renderHook(({ taskId }) => useRunScript(taskId, false), {
      initialProps: { taskId: "task-1" },
    });

    // Trigger state accumulation by starting
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "start_run_script") return Promise.reject("spawn failed");
      if (method === "get_run_status")
        return Promise.resolve({ running: false, pid: null, exit_code: null });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    await act(async () => {
      await result.current.start();
    });

    // Error is now set
    expect(result.current.error).toBe("spawn failed");

    // Rerender with a new taskId — state should reset
    act(() => {
      rerender({ taskId: "task-2" });
    });

    expect(result.current.status.running).toBe(false);
    expect(result.current.lines).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("sets error state when start fails", async () => {
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "start_run_script") return Promise.reject("spawn failed");
      if (method === "get_run_status")
        return Promise.resolve({ running: false, pid: null, exit_code: null });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    const { result } = renderHook(() => useRunScript("task-1", true));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe("spawn failed");
    expect(result.current.loading).toBe(false);
  });

  it("sets error state when stop fails", async () => {
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "stop_run_script") return Promise.reject("stop failed");
      if (method === "get_run_status")
        return Promise.resolve({ running: true, pid: 123, exit_code: null });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    const { result } = renderHook(() => useRunScript("task-1", true));

    // Wait for initial status fetch to complete
    await waitFor(() => {
      expect(result.current.status.running).toBe(true);
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.error).toBe("stop failed");
    expect(result.current.loading).toBe(false);
  });
});

describe("useRunScript ports", () => {
  it("starts as empty", () => {
    const { result } = renderHook(() => useRunScript("task-1", false));
    expect(result.current.ports).toEqual({});
  });

  it("accumulates ports from ORKESTRA_PORT lines in log poll", async () => {
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "get_run_status")
        return Promise.resolve({ running: true, pid: 123, exit_code: null });
      if (method === "get_run_logs")
        return Promise.resolve({
          lines: ["ORKESTRA_PORT Rails=3000", "ORKESTRA_PORT React=3002"],
          total_lines: 2,
        });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    const { result } = renderHook(() => useRunScript("task-1", true));

    await waitFor(() => {
      expect(result.current.ports).toEqual({ Rails: 3000, React: 3002 });
    });
  });

  it("resets ports on taskId change", async () => {
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "get_run_status")
        return Promise.resolve({ running: true, pid: 123, exit_code: null });
      if (method === "get_run_logs")
        return Promise.resolve({ lines: ["ORKESTRA_PORT Rails=3000"], total_lines: 1 });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    const { result, rerender } = renderHook(({ taskId }) => useRunScript(taskId, true), {
      initialProps: { taskId: "task-1" },
    });

    await waitFor(() => {
      expect(result.current.ports).toEqual({ Rails: 3000 });
    });

    act(() => {
      rerender({ taskId: "task-2" });
    });

    expect(result.current.ports).toEqual({});
  });

  it("resets ports on start()", async () => {
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "get_run_status")
        return Promise.resolve({ running: true, pid: 123, exit_code: null });
      if (method === "get_run_logs")
        return Promise.resolve({ lines: ["ORKESTRA_PORT Rails=3000"], total_lines: 1 });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    const { result } = renderHook(() => useRunScript("task-1", true));

    await waitFor(() => {
      expect(result.current.ports).toEqual({ Rails: 3000 });
    });

    // Switch mock: start succeeds, status returns stopped, no new port lines
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "start_run_script") return Promise.resolve(null);
      if (method === "get_run_status")
        return Promise.resolve({ running: false, pid: null, exit_code: null });
      if (method === "get_run_logs") return Promise.resolve({ lines: [], total_lines: 1 });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.ports).toEqual({});
  });

  it("re-declaring same label updates the port number", async () => {
    // Initial poll gives Rails=3000
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "get_run_status")
        return Promise.resolve({ running: true, pid: 123, exit_code: null });
      if (method === "get_run_logs")
        return Promise.resolve({ lines: ["ORKESTRA_PORT Rails=3000"], total_lines: 1 });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    const { result } = renderHook(() => useRunScript("task-1", true));

    await waitFor(() => {
      expect(result.current.ports).toEqual({ Rails: 3000 });
    });

    // Stop fetches remaining logs with Rails redeclared at 4000
    (mockTransportCall as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "stop_run_script") return Promise.resolve(null);
      if (method === "get_run_logs")
        return Promise.resolve({ lines: ["ORKESTRA_PORT Rails=4000"], total_lines: 2 });
      if (method === "get_run_status")
        return Promise.resolve({ running: false, pid: null, exit_code: 0 });
      return Promise.reject(new Error(`Unmocked: ${method}`));
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.ports).toEqual({ Rails: 4000 });
  });
});
