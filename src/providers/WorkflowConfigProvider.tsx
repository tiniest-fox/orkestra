/**
 * Provider for workflow configuration.
 * Always renders children immediately — callers must check loading/error state.
 * Orkestra is the single gate that decides what to show based on both this
 * and TasksProvider loading state.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type StartupData, startupData, startupError } from "../startup";

import { useConnectionState, useTransport } from "../transport";

import type { WorkflowConfig } from "../types/workflow";

interface WorkflowConfigState {
  config: WorkflowConfig | null;
  loading: boolean;
  error: unknown;
  retry: () => void;
}

const WorkflowConfigContext = createContext<WorkflowConfigState | null>(null);

/**
 * Access the raw config loading state. Use in gating components (Orkestra).
 */
export function useWorkflowConfigState(): WorkflowConfigState {
  const ctx = useContext(WorkflowConfigContext);
  if (!ctx) throw new Error("useWorkflowConfigState must be used within WorkflowConfigProvider");
  return ctx;
}

/**
 * Access workflow configuration. Only call from components that render after
 * Orkestra's loading gate — config is guaranteed non-null at that point.
 */
export function useWorkflowConfig(): WorkflowConfig {
  const ctx = useContext(WorkflowConfigContext);
  if (!ctx?.config) throw new Error("useWorkflowConfig called before config loaded");
  return ctx.config;
}

interface WorkflowConfigProviderProps {
  children: ReactNode;
}

function getProjectPath(): string {
  return new URLSearchParams(window.location.search).get("project") ?? "";
}

let cachedConfig: { projectUrl: string; config: WorkflowConfig } | null = null;

export function WorkflowConfigProvider({ children }: WorkflowConfigProviderProps) {
  const transport = useTransport();
  const connectionState = useConnectionState();
  const projectUrl = window.location.href;
  const initialConfig = cachedConfig?.projectUrl === projectUrl ? cachedConfig.config : null;
  const [config, setConfig] = useState<WorkflowConfig | null>(initialConfig);
  const [loading, setLoading] = useState(!initialConfig);
  const [error, setError] = useState<unknown>(null);
  // Incrementing retryKey re-triggers the fetch effect after a retry call.
  const [retryKey, setRetryKey] = useState(0);
  const retriesRef = useRef(0);
  const prevConnectionStateRef = useRef(connectionState);

  // Clear stale config and re-fetch when connection transitions from disconnected to connected.
  // Unlike TasksProvider and GitHistoryProvider (which rely on their polling loop to naturally
  // refresh after reconnect), this provider fetches only once and is not polled — so it must
  // explicitly invalidate on reconnect to avoid serving a stale config indefinitely.
  useEffect(() => {
    const prev = prevConnectionStateRef.current;
    prevConnectionStateRef.current = connectionState;
    if (prev === "disconnected" && connectionState === "connected") {
      cachedConfig = null;
      setConfig(null);
      setLoading(true);
      setError(null);
      setRetryKey((k) => k + 1);
    }
  }, [connectionState]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey triggers effect re-run on retry
  useEffect(() => {
    retriesRef.current = 0;
    console.timeEnd("[startup] config:react");

    // Fast path: module-level slots already populated before React mounted (Tauri only).
    if (startupError.value) {
      setError(startupError.value);
      setLoading(false);
      return;
    }
    if (transport.supportsLocalOperations && startupData.value) {
      console.timeEnd("[startup] config");
      setConfig(startupData.value.config);
      setLoading(false);
      return;
    }

    // Transport path: fetch via RPC.
    // For Tauri slow path: startup event not yet received, poll until ready.
    // For PWA: primary path, no module-level slots.
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchStartupData() {
      try {
        const data = await transport.call<StartupData | null>("get_startup_data");
        if (cancelled) return;
        if (data) {
          startupData.value = data;
          console.timeEnd("[startup] config");
          cachedConfig = { projectUrl, config: data.config };
          setConfig(data.config);
          setLoading(false);
        } else if (transport.supportsLocalOperations) {
          // Tauri slow path: startup data not ready yet, retry (max 30 × 100ms = 3s).
          if (retriesRef.current < 30) {
            retriesRef.current++;
            pollTimer = setTimeout(fetchStartupData, 100);
          } else {
            setError("Startup timed out — project may not be registered");
            setLoading(false);
          }
        } else {
          // PWA path: null response is unexpected.
          setError("Unable to load project data — check daemon connection");
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        if (transport.supportsLocalOperations) {
          // Tauri: project may not be registered yet, retry (max 30 × 100ms = 3s).
          if (retriesRef.current < 30) {
            retriesRef.current++;
            pollTimer = setTimeout(fetchStartupData, 100);
          } else {
            setError("Startup timed out — project may not be registered");
            setLoading(false);
          }
        } else {
          setError(err);
          setLoading(false);
        }
      }
    }

    fetchStartupData();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [transport, retryKey]);

  const retry = useCallback(async () => {
    const path = getProjectPath();
    startupError.value = null;
    startupData.value = null;
    cachedConfig = null;
    setError(null);
    setConfig(null);
    setLoading(true);

    // Tauri: tell the backend to re-initialize the project, then re-fetch.
    // Await so that a failed retry_startup is surfaced before the fetch effect runs.
    // PWA: no backend re-init needed — just re-fetch startup data.
    if (transport.supportsLocalOperations) {
      try {
        await transport.call("retry_startup", { path });
      } catch (e) {
        setError(e);
        setLoading(false);
        return;
      }
    }

    // Increment to re-run the fetch effect.
    setRetryKey((k) => k + 1);
  }, [transport]);

  return (
    <WorkflowConfigContext.Provider value={{ config, loading, error, retry }}>
      {children}
    </WorkflowConfigContext.Provider>
  );
}
