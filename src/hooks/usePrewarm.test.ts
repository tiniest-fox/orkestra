// Tests for usePrewarm: prewarmId state visibility and cleanup behavior.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockTransportCall } from "../test/mocks/transport";

vi.mock("../lib/petname", () => ({
  generatePetname: () => "ably-brave-cat",
}));

const mockCall = mockTransportCall as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCall.mockResolvedValue(undefined);
});

import { usePrewarm } from "./usePrewarm";

describe("usePrewarm", () => {
  it("returns null when not active", () => {
    const { result } = renderHook(() => usePrewarm(false));
    expect(result.current.prewarmId).toBeNull();
  });

  it("exposes prewarmId via state (triggers re-render) when active becomes true", async () => {
    const { result } = renderHook(() => usePrewarm(true));
    await waitFor(() => {
      expect(result.current.prewarmId).toBe("ably-brave-cat");
    });
    expect(mockCall).toHaveBeenCalledWith("prewarm_worktree", {
      task_id: "ably-brave-cat",
      base_branch: null,
    });
  });

  it("passes baseBranch to prewarm_worktree", async () => {
    renderHook(() => usePrewarm(true, "feature/my-branch"));
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("prewarm_worktree", {
        task_id: "ably-brave-cat",
        base_branch: "feature/my-branch",
      });
    });
  });

  it("calls cancel_prewarm with the correct id on unmount", async () => {
    const { result, unmount } = renderHook(() => usePrewarm(true));
    await waitFor(() => {
      expect(result.current.prewarmId).toBe("ably-brave-cat");
    });

    act(() => unmount());

    expect(mockCall).toHaveBeenCalledWith("cancel_prewarm", {
      task_id: "ably-brave-cat",
    });
  });

  it("clears prewarmId and cancels when active flips to false", async () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => usePrewarm(active),
      {
        initialProps: { active: true },
      },
    );

    await waitFor(() => {
      expect(result.current.prewarmId).toBe("ably-brave-cat");
    });

    rerender({ active: false });

    await waitFor(() => {
      expect(result.current.prewarmId).toBeNull();
    });
    expect(mockCall).toHaveBeenCalledWith("cancel_prewarm", {
      task_id: "ably-brave-cat",
    });
  });

  it("clears prewarmId when prewarm_worktree call fails", async () => {
    mockCall.mockRejectedValue(new Error("prewarm failed"));
    const { result } = renderHook(() => usePrewarm(true));

    // Wait for the rejection to be processed.
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("prewarm_worktree", expect.anything());
    });
    await waitFor(() => {
      expect(result.current.prewarmId).toBeNull();
    });
  });
});
