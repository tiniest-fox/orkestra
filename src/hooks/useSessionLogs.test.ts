// Tests for useSessionLogs: connection guard behavior and event-driven refresh.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockTransport, mockTransportCall } from "../test/mocks/transport";

// Capture handlers registered by useTransportListener keyed by event name.
const { capturedHandlers } = vi.hoisted(() => ({
  capturedHandlers: new Map<string, (data: unknown) => void>(),
}));

vi.mock("../transport/useTransportListener", () => ({
  useTransportListener: <T>(event: string, handler: (data: T) => void) => {
    capturedHandlers.set(event, handler as (data: unknown) => void);
  },
}));

function fireEvent(event: string, data: unknown) {
  const handler = capturedHandlers.get(event);
  if (!handler) throw new Error(`No handler registered for "${event}"`);
  handler(data);
}

import { useSessionLogs } from "./useSessionLogs";

const mockCall = mockTransportCall as ReturnType<typeof vi.fn>;

beforeEach(() => {
  capturedHandlers.clear();
  (mockTransport as { connectionState: string }).connectionState = "connected";
});

describe("useSessionLogs", () => {
  describe("connection guard", () => {
    it("suppresses log fetch when connectionState is not connected", () => {
      (mockTransport as { connectionState: string }).connectionState = "disconnected";
      renderHook(() => useSessionLogs("session-1"));
      expect(mockCall).not.toHaveBeenCalledWith("assistant_get_logs", expect.anything());
    });

    it("fetches logs when connected and sessionId is set", async () => {
      mockCall.mockResolvedValue([]);
      const { result } = renderHook(() => useSessionLogs("session-1"));
      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("assistant_get_logs", {
          session_id: "session-1",
        });
      });
      expect(result.current.logs).toEqual([]);
    });

    it("fetches logs on reconnect after being disconnected", async () => {
      (mockTransport as { connectionState: string }).connectionState = "disconnected";
      mockCall.mockResolvedValue([{ type: "text", content: "hello" }]);

      const { rerender } = renderHook(() => useSessionLogs("session-1"));
      expect(mockCall).not.toHaveBeenCalledWith("assistant_get_logs", expect.anything());

      (mockTransport as { connectionState: string }).connectionState = "connected";
      rerender();

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("assistant_get_logs", {
          session_id: "session-1",
        });
      });
    });

    it("clears logs when sessionId becomes null", async () => {
      mockCall.mockResolvedValue([{ type: "text", content: "entry" }]);
      const { result, rerender } = renderHook(
        ({ id }: { id: string | null }) => useSessionLogs(id),
        { initialProps: { id: "session-1" as string | null } },
      );

      await waitFor(() => {
        expect(result.current.logs).toHaveLength(1);
      });

      rerender({ id: null });
      expect(result.current.logs).toEqual([]);
    });
  });

  describe("event-driven refresh", () => {
    it("fetches logs when log_entry_appended fires for the active session", async () => {
      mockCall.mockResolvedValue([]);
      renderHook(() => useSessionLogs("session-1"));

      // Wait for the initial fetch triggered by the connection-gated effect.
      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledTimes(1);
      });

      mockCall.mockClear();

      await act(async () => {
        fireEvent("log_entry_appended", { task_id: "t1", session_id: "session-1" });
      });

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("assistant_get_logs", {
          session_id: "session-1",
        });
      });
    });

    it("ignores log_entry_appended for a different session", async () => {
      mockCall.mockResolvedValue([]);
      renderHook(() => useSessionLogs("session-1"));

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledTimes(1);
      });

      mockCall.mockClear();

      act(() => {
        fireEvent("log_entry_appended", { task_id: "t1", session_id: "session-OTHER" });
      });

      expect(mockCall).not.toHaveBeenCalledWith("assistant_get_logs", expect.anything());
    });
  });
});
