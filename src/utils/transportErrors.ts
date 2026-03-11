// Identifies errors caused by WebSocket disconnection.

const DISCONNECT_MESSAGES = [
  "WebSocket not connected",
  "WebSocket disconnected",
  "Transport closed",
];

/**
 * Returns true if the error was caused by a transport disconnect.
 * Used by providers to suppress transient errors during reconnection.
 */
export function isDisconnectError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return DISCONNECT_MESSAGES.some((m) => msg.includes(m));
}
