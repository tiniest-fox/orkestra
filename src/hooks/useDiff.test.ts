// Tests for useDiff: ETag-based short-circuit, loading state, polling behaviour.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockTransport, mockTransportCall } from "../test/mocks/transport";

// Mock usePolling to capture the polling callback for manual invocation in tests.
let capturedPollCallback: (() => Promise<void>) | null = null;
vi.mock("./usePolling", () => ({
  usePolling: (cb: (() => Promise<void>) | null) => {
    capturedPollCallback = cb;
  },
}));

import type { HighlightedFileDiff } from "./useDiff";
import { useDiff } from "./useDiff";

const mockCall = mockTransportCall as ReturnType<typeof vi.fn>;

function makeFile(overrides: Partial<HighlightedFileDiff> = {}): HighlightedFileDiff {
  return {
    path: "src/foo.ts",
    change_type: "modified",
    old_path: null,
    additions: 1,
    deletions: 1,
    is_binary: false,
    hunks: [
      {
        old_start: 1,
        old_count: 1,
        new_start: 1,
        new_count: 1,
        lines: [
          {
            line_type: "context",
            content: "hello world",
            html: "<span>hello world</span>",
            old_line_number: 1,
            new_line_number: 1,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeDiffResult(files: HighlightedFileDiff[] = [makeFile()], diffSha = "sha-1") {
  return { files, diff_sha: diffSha };
}

// ============================================================================
// useDiff — behavioral contracts
// ============================================================================

describe("useDiff", () => {
  beforeEach(() => {
    capturedPollCallback = null;
    mockCall.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    (mockTransport as { connectionState: string }).connectionState = "connected";
  });

  it("sets loading to true only on the first fetch, not on subsequent polls", async () => {
    const diffResult = makeDiffResult();
    mockCall.mockResolvedValue(diffResult);

    const { result } = renderHook(() => useDiff("task-1"));

    // Initial state — not yet fetched
    expect(result.current.loading).toBe(false);

    // First poll: loading should flip to true, then back to false
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.diff).toEqual(diffResult);

    // Second poll: loading must NOT flip back to true mid-fetch
    const anotherResult = makeDiffResult([makeFile({ additions: 99 })], "sha-2");
    mockCall.mockResolvedValue(anotherResult);
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(result.current.loading).toBe(false);
  });

  it("disables polling when connectionState is disconnected", () => {
    (mockTransport as { connectionState: string }).connectionState = "disconnected";
    renderHook(() => useDiff("task-1"));
    expect(capturedPollCallback).toBeNull();
  });

  it("sends last_sha from previous response on subsequent polls", async () => {
    mockCall.mockResolvedValue(makeDiffResult([makeFile()], "sha-abc"));
    renderHook(() => useDiff("task-1"));

    // First poll — no last_sha sent
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(mockCall).toHaveBeenCalledWith("get_task_diff", {
      task_id: "task-1",
      context_lines: 3,
    });

    // Second poll — last_sha from previous response
    mockCall.mockResolvedValue(makeDiffResult([makeFile()], "sha-abc"));
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(mockCall).toHaveBeenLastCalledWith("get_task_diff", {
      task_id: "task-1",
      context_lines: 3,
      last_sha: "sha-abc",
    });
  });

  it("resets diffShaRef when taskId changes, preventing stale last_sha", async () => {
    // First task — get a diff_sha
    mockCall.mockResolvedValue(makeDiffResult([makeFile()], "sha-task1"));
    const { result, rerender } = renderHook(({ taskId }: { taskId: string }) => useDiff(taskId), {
      initialProps: { taskId: "task-1" },
    });

    await act(async () => {
      await capturedPollCallback?.();
    });
    // Confirm sha was stored
    expect(mockCall).toHaveBeenLastCalledWith("get_task_diff", {
      task_id: "task-1",
      context_lines: 3,
    });

    // Second poll sends last_sha for task-1
    mockCall.mockResolvedValue({ unchanged: true, diff_sha: "sha-task1" });
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(mockCall).toHaveBeenLastCalledWith("get_task_diff", {
      task_id: "task-1",
      context_lines: 3,
      last_sha: "sha-task1",
    });

    // Switch to task-2
    mockCall.mockResolvedValue(makeDiffResult([makeFile({ path: "src/bar.ts" })], "sha-task2"));
    rerender({ taskId: "task-2" });

    // First poll for task-2 must NOT include last_sha (stale from task-1)
    await act(async () => {
      await capturedPollCallback?.();
    });
    expect(mockCall).toHaveBeenLastCalledWith("get_task_diff", {
      task_id: "task-2",
      context_lines: 3,
    });

    // Confirm result has task-2 diff
    expect(result.current.diff?.files[0].path).toBe("src/bar.ts");
  });

  it("preserves existing diff state on unchanged response", async () => {
    const diffResult = makeDiffResult([makeFile()], "sha-abc");
    mockCall.mockResolvedValue(diffResult);
    const { result } = renderHook(() => useDiff("task-1"));

    // First fetch — diff is set
    await act(async () => {
      await capturedPollCallback?.();
    });
    const diffAfterFirst = result.current.diff;
    expect(diffAfterFirst).not.toBeNull();

    // Second fetch returns unchanged
    mockCall.mockResolvedValue({ unchanged: true, diff_sha: "sha-abc" });
    await act(async () => {
      await capturedPollCallback?.();
    });
    // Diff reference should be exactly the same object (no re-render)
    expect(result.current.diff).toBe(diffAfterFirst);
  });
});
