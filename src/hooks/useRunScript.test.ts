//! Tests for the useRunScript hook: initial state, taskId reset, and error handling.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, resetMocks } from "../test/mocks/tauri";
import { useRunScript } from "./useRunScript";

beforeEach(() => {
  resetMocks();
});

afterEach(() => {});

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
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "start_run_script") return Promise.reject("spawn failed");
      if (cmd === "get_run_status")
        return Promise.resolve({ running: false, pid: null, exit_code: null });
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
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
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "start_run_script") return Promise.reject("spawn failed");
      if (cmd === "get_run_status")
        return Promise.resolve({ running: false, pid: null, exit_code: null });
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    const { result } = renderHook(() => useRunScript("task-1", true));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe("spawn failed");
    expect(result.current.loading).toBe(false);
  });

  it("sets error state when stop fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "stop_run_script") return Promise.reject("stop failed");
      if (cmd === "get_run_status")
        return Promise.resolve({ running: true, pid: 123, exit_code: null });
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
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
