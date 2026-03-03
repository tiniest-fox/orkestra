//! Hook for subscribing to transport events with ref-captured handler.

import { useEffect, useRef } from "react";
import { useTransport } from "./TransportProvider";

/**
 * Subscribe to a transport event. Cleans up on unmount.
 *
 * Works with both Tauri IPC and WebSocket transports via the transport abstraction.
 *
 * The handler is captured by ref so callers don't need to memoize it — any
 * function can be passed without risking stale closures or missing updates.
 */
export function useTransportListener<T>(event: string, handler: (data: T) => void): void {
  const transport = useTransport();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return transport.on<T>(event, (data) => {
      handlerRef.current(data);
    });
  }, [transport, event]);
}
