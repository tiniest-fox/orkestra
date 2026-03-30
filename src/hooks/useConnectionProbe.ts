// Probes WebSocket connection health on visibility change (hidden → visible).

import { useEffect } from "react";
import type { Transport } from "../transport/types";

/**
 * When the page transitions from hidden to visible, probes the transport
 * connection to detect dead sockets. Only has an effect on transports that
 * implement probeConnection (WebSocketTransport).
 */
export function useConnectionProbe(transport: Transport): void {
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        transport.probeConnection?.();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [transport]);
}
