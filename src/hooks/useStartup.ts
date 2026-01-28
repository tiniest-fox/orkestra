import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StartupError, StartupStatus, StartupWarning } from "../types/startup";

/** Polling interval while startup is initializing (ms) */
const POLL_INTERVAL = 100;

/**
 * Hook for checking startup status.
 *
 * This hook should be used before any other workflow hooks to ensure
 * the backend has initialized successfully.
 *
 * Triggers backend initialization when mounted, then polls until startup
 * completes (either "ready" or "failed").
 *
 * @returns Startup state including loading, status, errors, warnings, and retry function
 */
export function useStartup() {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [initTriggered, setInitTriggered] = useState(false);
  const pollRef = useRef<number | null>(null);

  const checkStatus = useCallback(() => {
    setLoading(true);
    invoke<StartupStatus>("get_startup_status")
      .then((result) => {
        setStatus(result);
        // Only stop loading when we have a terminal state
        if (result.status !== "initializing") {
          setLoading(false);
        }
      })
      .catch((err) => {
        // If we can't even communicate with the backend, create a synthetic error
        console.error("[startup] Failed to get startup status:", err);
        setStatus({
          status: "failed",
          errors: [
            {
              category: "database_error",
              message: `Failed to communicate with backend: ${String(err)}`,
              details: [],
              remediation: "Try restarting the application",
            },
          ],
        });
        setLoading(false);
      });
  }, []);

  // Trigger backend initialization once when mounted (after splash screen renders)
  useEffect(() => {
    if (!initTriggered) {
      setInitTriggered(true);
      console.log("[startup] UI loaded, triggering backend initialization");
      // Fire and forget - the backend will update status when ready
      invoke("begin_initialization").catch((err) => {
        console.error("[startup] Failed to trigger initialization:", err);
      });
      // Start polling for status
      checkStatus();
    }
  }, [initTriggered, checkStatus]);

  // Poll while status is "initializing"
  useEffect(() => {
    if (status?.status === "initializing") {
      pollRef.current = window.setInterval(() => {
        checkStatus();
      }, POLL_INTERVAL);
    } else if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.status, checkStatus]);

  // Extract errors and warnings based on status
  const errors: StartupError[] = status?.status === "failed" ? status.errors : [];
  const warnings: StartupWarning[] = status?.status === "ready" ? status.warnings : [];
  const isReady = status?.status === "ready";
  const projectRoot = status?.status === "ready" ? status.project_root : null;

  return {
    /** Current startup status (null while loading) */
    status,
    /** Whether startup check is in progress */
    loading,
    /** Whether startup completed successfully */
    isReady,
    /** List of startup errors (empty if successful) */
    errors,
    /** List of non-fatal warnings */
    warnings,
    /** Project root path (only available if ready) */
    projectRoot,
    /** Re-check startup status (for retry after fixing config) */
    retry: checkStatus,
  };
}
