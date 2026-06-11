// Identifies errors caused by WebSocket disconnection.

import { extractErrorMessage } from "./errors";

const DISCONNECT_MESSAGES = [
  "WebSocket not connected",
  "WebSocket disconnected",
  "Transport closed",
  "Request timed out",
];

/**
 * Returns true if the error was caused by a transport disconnect.
 * Used by providers to suppress transient errors during reconnection.
 */
export function isDisconnectError(err: unknown): boolean {
  const msg = extractErrorMessage(err);
  return DISCONNECT_MESSAGES.some((m) => msg.includes(m));
}
