//! Transport interface and connection state types.

export type ConnectionState = "connected" | "connecting" | "disconnected";

/**
 * Abstraction over Tauri IPC and WebSocket communication.
 *
 * Components call `transport.call()` and `transport.on()` without knowing
 * whether they're running inside Tauri or as a PWA over WebSocket.
 */
export interface Transport {
  /** RPC call using canonical method name. */
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Subscribe to a canonical event name. Returns unsubscribe function. */
  on<T = unknown>(event: string, handler: (data: T) => void): () => void;
  /** Current connection state. */
  readonly connectionState: ConnectionState;
  /** Subscribe to connection state changes. Returns unsubscribe function. */
  onConnectionStateChange(handler: (state: ConnectionState) => void): () => void;
  /** Whether this transport supports local operations (file system, terminal, run script). */
  readonly supportsLocalOperations: boolean;
  /**
   * Whether this transport requires user authentication (pairing/token exchange).
   *
   * True for WebSocket (PWA), false for Tauri IPC. Use this to gate auth flows
   * rather than `!supportsLocalOperations`, which is about local OS access, not auth.
   */
  readonly requiresAuthentication: boolean;
  /** Stop reconnecting and close the connection. Optional — not all transports need explicit cleanup. */
  close?(): void;
}
