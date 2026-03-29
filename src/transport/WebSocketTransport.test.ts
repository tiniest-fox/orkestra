import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketTransport } from "./WebSocketTransport";

// ============================================================================
// Mock WebSocket
// ============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  readonly sentMessages: string[] = [];

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.simulateClose();
  }

  simulateOpen(): void {
    this.onopen?.({ type: "open" } as Event);
  }

  simulateMessage(data: unknown): void {
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.({ data: raw } as MessageEvent);
  }

  simulateClose(): void {
    this.onclose?.({ type: "close" } as CloseEvent);
  }

  simulateError(): void {
    this.onerror?.({ type: "error" } as Event);
  }
}

function createFactory(): (url: string) => WebSocket {
  return (url: string) => new MockWebSocket(url) as unknown as WebSocket;
}

function latestSocket(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a transport connected to a mock WebSocket, already in open state.
 */
function makeConnectedTransport(): WebSocketTransport {
  const t = new WebSocketTransport("ws://localhost:3847/ws", "test-token", createFactory());
  const ws = latestSocket();
  ws.simulateOpen();
  return t;
}

// ============================================================================
// Tests
// ============================================================================

describe("WebSocketTransport", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    MockWebSocket.instances = [];
  });

  // -- Construction and URL building --

  it("appends token as query param in the WebSocket URL", () => {
    new WebSocketTransport("ws://localhost:3847/ws", "my-secret", createFactory());
    expect(latestSocket().url).toBe("ws://localhost:3847/ws?token=my-secret");
  });

  it("omits token query param when token is empty string", () => {
    new WebSocketTransport("ws://localhost:3847/ws", "", createFactory());
    expect(latestSocket().url).toBe("ws://localhost:3847/ws");
  });

  it("starts in connecting state", () => {
    const t = new WebSocketTransport("ws://localhost:3847/ws", "", createFactory());
    expect(t.connectionState).toBe("connecting");
  });

  it("transitions to connected state on open", () => {
    const t = makeConnectedTransport();
    expect(t.connectionState).toBe("connected");
  });

  it("supportsLocalOperations is false", () => {
    const t = makeConnectedTransport();
    expect(t.supportsLocalOperations).toBe(false);
  });

  it("requiresAuthentication is true", () => {
    const t = makeConnectedTransport();
    expect(t.requiresAuthentication).toBe(true);
  });

  // -- Request/response correlation --

  describe("call() — request/response correlation", () => {
    it("sends a JSON-RPC request and resolves with the response result", async () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();

      const promise = t.call<string>("list_tasks");

      expect(ws.sentMessages).toHaveLength(1);
      const sent = JSON.parse(ws.sentMessages[0]) as { id: string; method: string };
      expect(sent.method).toBe("list_tasks");

      // Server responds with matching id
      ws.simulateMessage({ id: sent.id, result: ["task-1", "task-2"] });
      await expect(promise).resolves.toEqual(["task-1", "task-2"]);
    });

    it("correlates responses by id — out-of-order responses resolve correct promises", async () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();

      const p1 = t.call<string>("approve");
      const p2 = t.call<string>("reject");

      const [msg1, msg2] = ws.sentMessages.map((m) => JSON.parse(m) as { id: string });

      // Respond to second request first
      ws.simulateMessage({ id: msg2.id, result: "rejected" });
      ws.simulateMessage({ id: msg1.id, result: "approved" });

      await expect(p1).resolves.toBe("approved");
      await expect(p2).resolves.toBe("rejected");
    });

    it("rejects with error message when server returns an error payload", async () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();

      const promise = t.call<string>("approve");
      const sent = JSON.parse(ws.sentMessages[0]) as { id: string };
      ws.simulateMessage({
        id: sent.id,
        error: { code: "TASK_NOT_FOUND", message: "Task not found: abc" },
      });

      await expect(promise).rejects.toThrow("TASK_NOT_FOUND: Task not found: abc");
    });

    it("rejects call() with NotConnected error when not connected", async () => {
      const t = new WebSocketTransport("ws://localhost:3847/ws", "", createFactory());
      // State is 'connecting', socket exists but is not open yet.
      await expect(t.call("list_tasks")).rejects.toThrow("WebSocket not connected");
    });

    it("sends params in the request", () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();

      t.call("approve", { task_id: "task-42" });

      const sent = JSON.parse(ws.sentMessages[0]) as { params: Record<string, string> };
      expect(sent.params).toEqual({ task_id: "task-42" });
    });
  });

  // -- Pending requests rejected on disconnect --

  describe("disconnect — rejects pending requests", () => {
    it("rejects all in-flight requests when the socket closes", async () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();

      const p1 = t.call<string>("approve");
      const p2 = t.call<string>("reject");

      // Don't respond — simulate disconnect instead
      ws.simulateClose();

      await expect(p1).rejects.toThrow("WebSocket disconnected");
      await expect(p2).rejects.toThrow("WebSocket disconnected");
    });

    it("rejects pending requests when error is followed by close (per WebSocket spec)", async () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();

      const promise = t.call<string>("list_tasks");
      // Per WebSocket spec, onerror always fires before onclose. The close is
      // what drives _handleDisconnect(); onerror only logs.
      ws.simulateError();
      ws.simulateClose();

      await expect(promise).rejects.toThrow("WebSocket disconnected");
    });

    it("transitions to disconnected state on close", () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();

      ws.simulateClose();
      expect(t.connectionState).toBe("disconnected");
    });
  });

  // -- Event listener registration and dispatch --

  describe("on() — event listener registration and dispatch", () => {
    it("calls registered handler when server pushes a matching event", () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();
      const handler = vi.fn();

      t.on("task_updated", handler);

      ws.simulateMessage({ event: "task_updated", data: { task_id: "t1" } });
      expect(handler).toHaveBeenCalledWith({ task_id: "t1" });
    });

    it("dispatches to multiple handlers for the same event", () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();
      const h1 = vi.fn();
      const h2 = vi.fn();

      t.on("task_updated", h1);
      t.on("task_updated", h2);

      ws.simulateMessage({ event: "task_updated", data: "payload" });
      expect(h1).toHaveBeenCalledWith("payload");
      expect(h2).toHaveBeenCalledWith("payload");
    });

    it("does not dispatch to handlers for a different event", () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();
      const handler = vi.fn();

      t.on("task_updated", handler);
      ws.simulateMessage({ event: "review_ready", data: { task_id: "t1" } });

      expect(handler).not.toHaveBeenCalled();
    });

    it("removes handler when the returned unsubscribe function is called", () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();
      const handler = vi.fn();

      const unsub = t.on("task_updated", handler);
      unsub();

      ws.simulateMessage({ event: "task_updated", data: "payload" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("registration is synchronous — handler receives events immediately after on()", () => {
      const t = makeConnectedTransport();
      const ws = latestSocket();
      const handler = vi.fn();

      // No await — registration must be synchronous
      t.on("task_updated", handler);
      ws.simulateMessage({ event: "task_updated", data: "immediate" });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // -- Reconnection with exponential backoff --

  describe("reconnection — exponential backoff", () => {
    it("first reconnect attempt is instant (0ms delay)", () => {
      const t = makeConnectedTransport();
      latestSocket().simulateClose();

      expect(t.connectionState).toBe("disconnected");
      expect(MockWebSocket.instances).toHaveLength(1);

      // 0ms timer — flush with advanceTimersByTime(0)
      vi.advanceTimersByTime(0);
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("uses exponential backoff after first instant attempt fails", () => {
      makeConnectedTransport();

      // First disconnect → instant reconnect (0ms).
      latestSocket().simulateClose();
      vi.advanceTimersByTime(0);
      expect(MockWebSocket.instances).toHaveLength(2);

      // Second disconnect (instant attempt failed) → schedules reconnect after 1s.
      latestSocket().simulateClose();

      vi.advanceTimersByTime(999);
      expect(MockWebSocket.instances).toHaveLength(2); // Not yet

      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances).toHaveLength(3); // Reconnected
    });

    it("doubles the backoff delay on repeated failed reconnects", () => {
      makeConnectedTransport();

      // First disconnect → instant (0ms).
      latestSocket().simulateClose();
      vi.advanceTimersByTime(0);

      // Second disconnect (first backoff attempt, 1s) → delay doubles to 2s.
      latestSocket().simulateClose();
      vi.advanceTimersByTime(1_000);
      // A new socket is created but we do NOT call simulateOpen() — opening
      // would reset the delay, which is NOT what this test is verifying.

      // Third disconnect → should use 2s.
      latestSocket().simulateClose();
      expect(MockWebSocket.instances).toHaveLength(3);

      vi.advanceTimersByTime(1_999);
      expect(MockWebSocket.instances).toHaveLength(3); // Not yet

      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances).toHaveLength(4); // Reconnected
    });

    it("caps reconnect delay at 30s", () => {
      makeConnectedTransport();

      // Exhaust the instant-reconnect flag, then drive the backoff past 30s
      // without opening (so the flag is never reset).
      latestSocket().simulateClose(); // instant (0ms)
      vi.advanceTimersByTime(0);

      for (let i = 0; i < 10; i++) {
        latestSocket().simulateClose();
        vi.advanceTimersByTime(60_000); // advance more than max
      }

      const instancesBefore = MockWebSocket.instances.length;
      latestSocket().simulateClose();

      // Capped at 30s — advancing 30s should trigger the next reconnect.
      vi.advanceTimersByTime(30_000);
      expect(MockWebSocket.instances.length).toBe(instancesBefore + 1);
    });

    it("resets instant reconnect flag after successful connection", () => {
      makeConnectedTransport();

      // First disconnect → instant reconnect.
      latestSocket().simulateClose();
      vi.advanceTimersByTime(0);
      latestSocket().simulateOpen(); // Successful connection → flag resets.

      // Second disconnect — instant again because flag was reset.
      latestSocket().simulateClose();
      const countBefore = MockWebSocket.instances.length;

      vi.advanceTimersByTime(0);
      expect(MockWebSocket.instances.length).toBe(countBefore + 1);
    });

    it("transitions through disconnected → connecting → connected on reconnect", () => {
      const states: string[] = [];
      const t = makeConnectedTransport();

      t.onConnectionStateChange((s) => states.push(s));

      latestSocket().simulateClose();
      expect(states).toContain("disconnected");

      // First reconnect is instant — advancing 0ms triggers it.
      vi.advanceTimersByTime(0);
      expect(states).toContain("connecting");

      latestSocket().simulateOpen();
      expect(states).toContain("connected");
    });
  });

  // -- Connection state change notifications --

  describe("onConnectionStateChange()", () => {
    it("notifies subscribers when state changes", () => {
      const handler = vi.fn();
      const t = new WebSocketTransport("ws://localhost:3847/ws", "", createFactory());

      t.onConnectionStateChange(handler);
      latestSocket().simulateOpen();

      expect(handler).toHaveBeenCalledWith("connected");
    });

    it("unsubscribes handler when cleanup is called", () => {
      const handler = vi.fn();
      const t = makeConnectedTransport();

      const cleanup = t.onConnectionStateChange(handler);
      cleanup();

      latestSocket().simulateClose();
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
