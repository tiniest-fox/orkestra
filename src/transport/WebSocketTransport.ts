//! WebSocket JSON-RPC transport with reconnection and event demultiplexing.

import type { ConnectionState, Transport } from "./types";

// ============================================================================
// Protocol Types
// ============================================================================

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A message received from the server — either an RPC response or a server-push event. */
type ServerMessage =
  | { id: string; result: unknown; event?: undefined }
  | { id: string; error: { code: string; message: string }; event?: undefined }
  | { event: string; data: unknown; id?: undefined };

// ============================================================================
// Constants
// ============================================================================

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 1_000;
const STABLE_CONNECTION_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_000;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Transport implementation backed by a WebSocket connection to the daemon.
 *
 * Implements JSON-RPC for request/response and an event channel for server-push
 * notifications. The first reconnect after a stable connection (>5s) is instant (0ms);
 * subsequent attempts use exponential backoff (1s → 1s cap).
 *
 * The optional `createWebSocket` constructor parameter makes the transport testable
 * without real WebSocket connections.
 */
export class WebSocketTransport implements Transport {
  readonly supportsLocalOperations = false;
  readonly requiresAuthentication = true;

  private _connectionState: ConnectionState = "disconnected";
  private readonly _stateListeners = new Set<(state: ConnectionState) => void>();
  private readonly _eventListeners = new Map<string, Set<(data: unknown) => void>>();
  private readonly _pending = new Map<string, PendingRequest>();
  private _nextId = 1;
  private _ws: WebSocket | null = null;
  private _reconnectDelay = RECONNECT_BASE_DELAY_MS;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectedAt: number | null = null;
  private _probeInFlight = false;

  constructor(
    private readonly _url: string,
    private readonly _token: string,
    private readonly _createWebSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {
    this._connect();
  }

  // -- Transport interface --

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this._connectionState !== "connected" || !this._ws) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = String(this._nextId++);

      const timer = setTimeout(() => {
        if (!this._pending.has(id)) return;
        this._pending.delete(id);
        reject(new Error("Request timed out"));
        this._handleDisconnect();
      }, REQUEST_TIMEOUT_MS);

      this._pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      const message = JSON.stringify({ id, method, params: params ?? {} });
      try {
        this._ws.send(message);
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  /** Probe connection health by sending a ping RPC. Force-disconnects if no response within 2s. */
  probeConnection(): void {
    if (this._connectionState !== "connected" || !this._ws || this._probeInFlight) return;
    this._probeInFlight = true;

    const probeId = String(this._nextId++);
    const ws = this._ws;

    const timer = setTimeout(() => {
      this._probeInFlight = false;
      if (!this._pending.has(probeId)) return;
      this._pending.delete(probeId);
      // Socket is likely dead — force reconnect
      if (this._ws === ws) {
        this._handleDisconnect();
      }
    }, PROBE_TIMEOUT_MS);

    this._pending.set(probeId, {
      resolve: () => {
        clearTimeout(timer);
        this._probeInFlight = false;
      },
      reject: () => {
        clearTimeout(timer);
        this._probeInFlight = false;
      },
      timer,
    });

    try {
      ws.send(JSON.stringify({ id: probeId, method: "ping", params: {} }));
    } catch {
      clearTimeout(timer);
      this._pending.delete(probeId);
      this._probeInFlight = false;
      this._handleDisconnect();
    }
  }

  on<T = unknown>(event: string, handler: (data: T) => void): () => void {
    let listeners = this._eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this._eventListeners.set(event, listeners);
    }
    const typedHandler = handler as (data: unknown) => void;
    listeners.add(typedHandler);
    return () => {
      listeners.delete(typedHandler);
    };
  }

  onConnectionStateChange(handler: (state: ConnectionState) => void): () => void {
    this._stateListeners.add(handler);
    return () => {
      this._stateListeners.delete(handler);
    };
  }

  /** Stop reconnecting and close the WebSocket connection. */
  close(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      // Remove all handlers before closing to prevent _handleDisconnect from scheduling a reconnect.
      this._ws.onopen = null;
      this._ws.onmessage = null;
      this._ws.onclose = null;
      this._ws.onerror = null;
      this._ws.close();
      this._ws = null;
    }
    // Reject any pending requests so callers don't hang.
    for (const [, request] of this._pending) {
      clearTimeout(request.timer);
      request.reject(new Error("Transport closed"));
    }
    this._pending.clear();
    this._setConnectionState("disconnected");
  }

  // -- Helpers --

  private _connect(): void {
    this._setConnectionState("connecting");

    const url = this._token ? `${this._url}?token=${encodeURIComponent(this._token)}` : this._url;

    const ws = this._createWebSocket(url);
    this._ws = ws;

    ws.onopen = () => {
      // Guard: if a newer connection has replaced this one, close and bail.
      if (this._ws !== ws) {
        ws.close();
        return;
      }
      this._reconnectDelay = RECONNECT_BASE_DELAY_MS;
      this._connectedAt = Date.now();
      this._setConnectionState("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      this._handleMessage(event.data as string);
    };

    ws.onclose = () => {
      this._handleDisconnect();
    };

    ws.onerror = () => {
      console.warn("[WebSocketTransport] Connection error");
    };
  }

  private _handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      console.warn("[WebSocketTransport] Failed to parse server message:", raw);
      return;
    }

    // Server-push event (has `event` field, no `id`)
    if (msg.event !== undefined) {
      const listeners = this._eventListeners.get(msg.event);
      if (listeners) {
        for (const listener of listeners) {
          listener(msg.data);
        }
      }
      return;
    }

    // RPC response (has `id` field)
    if (msg.id !== undefined) {
      const pending = this._pending.get(msg.id);
      if (!pending) return;
      this._pending.delete(msg.id);
      clearTimeout(pending.timer);

      if ("error" in msg && msg.error) {
        pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve("result" in msg ? msg.result : undefined);
      }
    }
  }

  private _handleDisconnect(): void {
    // Guard: only handle disconnect once per connection instance.
    if (!this._ws) return;
    this._ws = null;

    // Reject all in-flight requests so callers don't hang forever.
    for (const [, request] of this._pending) {
      clearTimeout(request.timer);
      request.reject(new Error("WebSocket disconnected"));
    }
    this._pending.clear();

    this._setConnectionState("disconnected");

    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
    }

    // First reconnect after a stable connection (>=5s) is instant.
    // If the connection was short-lived, accumulate backoff without resetting.
    const wasStable =
      this._connectedAt !== null && Date.now() - this._connectedAt >= STABLE_CONNECTION_MS;
    this._connectedAt = null;
    const delay = wasStable ? 0 : this._reconnectDelay;
    if (!wasStable) {
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
    }

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  private _setConnectionState(state: ConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    for (const listener of this._stateListeners) {
      listener(state);
    }
  }
}
