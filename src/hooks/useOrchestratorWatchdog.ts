// Polls the orchestrator lock file and auto-restarts when stale or absent.

import { useCallback, useRef } from "react";
import { useConnectionState, useTransport } from "../transport/TransportProvider";
import { usePageVisibility } from "./usePageVisibility";
import { usePolling } from "./usePolling";

const MAX_RETRIES = 3;

/**
 * Polls `get_orchestrator_status` every 10s and calls `retry_startup` when the
 * lock is stale or absent. No-op outside Tauri (PWA/web mode).
 *
 * Caps at MAX_RETRIES consecutive restart attempts; resets when status returns
 * to "running". Polling is suppressed when the page is hidden or disconnected.
 */
export function useOrchestratorWatchdog(): void {
  const transport = useTransport();
  const isVisible = usePageVisibility();
  const connectionState = useConnectionState();
  const retryCountRef = useRef(0);

  const checkAndRestart = useCallback(async () => {
    if (!import.meta.env.TAURI_ENV_PLATFORM) return;

    try {
      const result = await transport.call<{ status: string; pid?: number }>(
        "get_orchestrator_status",
      );

      if (result.status === "running") {
        retryCountRef.current = 0;
        return;
      }

      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        const info = await transport.call<{ project_root: string }>("get_project_info");
        await transport.call("retry_startup", { path: info.project_root });
      }
    } catch (err) {
      console.warn("Watchdog check failed:", err);
    }
  }, [transport]);

  const canPoll = isVisible && connectionState === "connected";
  usePolling(canPoll ? checkAndRestart : null, 10_000);
}
