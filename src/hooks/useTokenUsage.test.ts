// Tests for useTokenUsage — fetch on enable, skip when disabled, state reset on taskId change.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type vi } from "vitest";
import { mockTransportCall } from "../test/mocks/transport";
import type { TaskTokenUsage } from "../types/workflow";
import { useTokenUsage } from "./useTokenUsage";

// ============================================================================
// Fixtures
// ============================================================================

function makeTokenUsage(taskId: string): TaskTokenUsage {
  return {
    task_id: taskId,
    stages: [],
    total: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 20,
    },
  };
}

const mockCall = mockTransportCall as ReturnType<typeof vi.fn>;

// ============================================================================
// Tests
// ============================================================================

describe("useTokenUsage", () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  it("returns null and not loading initially when disabled", () => {
    mockCall.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTokenUsage("task-1", false));
    expect(result.current.tokenUsage).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("fetches token usage when enabled", async () => {
    const usage = makeTokenUsage("task-1");
    mockCall.mockResolvedValue(usage);

    const { result } = renderHook(() => useTokenUsage("task-1", true));

    await waitFor(() => expect(result.current.tokenUsage).toEqual(usage));
    expect(mockCall).toHaveBeenCalledWith("get_token_usage", { task_id: "task-1" });
  });

  it("does not fetch when disabled", async () => {
    mockCall.mockResolvedValue(makeTokenUsage("task-1"));
    renderHook(() => useTokenUsage("task-1", false));
    await act(async () => {});
    expect(mockCall).not.toHaveBeenCalledWith("get_token_usage", expect.anything());
  });

  it("resets state when taskId changes", async () => {
    const usageA = makeTokenUsage("task-a");
    const usageB = makeTokenUsage("task-b");

    mockCall.mockImplementation((_method: string, args: { task_id: string }) =>
      Promise.resolve(args.task_id === "task-a" ? usageA : usageB),
    );

    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) => useTokenUsage(taskId, true),
      { initialProps: { taskId: "task-a" } },
    );

    await waitFor(() => expect(result.current.tokenUsage).toEqual(usageA));

    // Switch to task-b — state must clear before the new fetch resolves
    rerender({ taskId: "task-b" });
    expect(result.current.tokenUsage).toBeNull();

    await waitFor(() => expect(result.current.tokenUsage).toEqual(usageB));
  });

  it("re-fetches after switching A → B → A", async () => {
    const usageA = makeTokenUsage("task-a");
    mockCall.mockResolvedValue(usageA);

    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) => useTokenUsage(taskId, true),
      { initialProps: { taskId: "task-a" } },
    );

    await waitFor(() => expect(result.current.tokenUsage).toEqual(usageA));
    const callsAfterFirst = mockCall.mock.calls.length;

    // Switch away and back — the ref was cleared, so task-a must be re-fetched
    rerender({ taskId: "task-b" });
    await act(async () => {});
    rerender({ taskId: "task-a" });

    await waitFor(() => expect(mockCall.mock.calls.length).toBeGreaterThan(callsAfterFirst + 1));
    expect(result.current.tokenUsage).toEqual(usageA);
  });
});
