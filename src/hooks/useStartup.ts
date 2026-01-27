import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { StartupError, StartupStatus, StartupWarning } from "../types/startup";

/**
 * Hook for checking startup status.
 *
 * This hook should be used before any other workflow hooks to ensure
 * the backend has initialized successfully.
 *
 * @returns Startup state including loading, status, errors, warnings, and retry function
 */
export function useStartup() {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const checkStatus = useCallback(() => {
    setLoading(true);
    invoke<StartupStatus>("get_startup_status")
      .then((result) => {
        setStatus(result);
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
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

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
