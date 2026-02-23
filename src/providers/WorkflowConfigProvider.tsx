/**
 * Provider for workflow configuration.
 * Always renders children immediately — callers must check loading/error state.
 * Orkestra is the single gate that decides what to show based on both this
 * and TasksProvider loading state.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { startupData, startupError } from "../main";
import type { WorkflowConfig, WorkflowTaskView } from "../types/workflow";
import { safeUnlisten } from "../utils/safeUnlisten";

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

interface StartupData {
  config: WorkflowConfig;
  tasks: WorkflowTaskView[];
}

export function WorkflowConfigProvider({ children }: WorkflowConfigProviderProps) {
  const [config, setConfig] = useState<WorkflowConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    console.timeEnd("[startup] config:react");

    // Fast path: module-level slots already populated before React mounted.
    if (startupError.value) {
      setError(startupError.value);
      setLoading(false);
      return;
    }
    if (startupData.value) {
      console.timeEnd("[startup] config");
      setConfig(startupData.value.config);
      setLoading(false);
      return;
    }

    // Slow path: startup data wasn't captured before React mounted.
    // Poll the IPC slot until it's populated (idempotent — no take semantics).
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    function poll() {
      invoke<StartupData | null>("workflow_get_startup_data")
        .then((data) => {
          if (cancelled) return;
          if (data) {
            startupData.value = data;
            console.timeEnd("[startup] config");
            setConfig(data.config);
            setLoading(false);
          } else {
            pollTimer = setTimeout(poll, 100);
          }
        })
        .catch(() => {
          // Project not registered yet — retry.
          if (!cancelled) pollTimer = setTimeout(poll, 100);
        });
    }

    poll();

    // Listen for startup-error in case init fails.
    const errorPromise = listen<{ message: string }>("startup-error", ({ payload }) => {
      if (cancelled) return;
      startupError.value = payload.message;
      setError(payload.message);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      safeUnlisten(errorPromise);
    };
  }, []);

  function retry() {
    const path = getProjectPath();
    startupError.value = null;
    startupData.value = null;
    setError(null);
    setConfig(null);
    setLoading(true);

    // One-shot listeners for the retry response.
    let settled = false;

    const dataPromise = listen<StartupData>("startup-data", ({ payload }) => {
      if (settled) return;
      settled = true;
      startupData.value = payload;
      setConfig(payload.config);
      setLoading(false);
      safeUnlisten(dataPromise);
      safeUnlisten(errorPromise);
    });

    const errorPromise = listen<{ message: string }>("startup-error", ({ payload }) => {
      if (settled) return;
      settled = true;
      startupError.value = payload.message;
      setError(payload.message);
      setLoading(false);
      safeUnlisten(dataPromise);
      safeUnlisten(errorPromise);
    });

    invoke("workflow_retry_startup", { path }).catch((e: unknown) => {
      if (settled) return;
      settled = true;
      setError(e);
      setLoading(false);
      safeUnlisten(dataPromise);
      safeUnlisten(errorPromise);
    });
  }

  return (
    <WorkflowConfigContext.Provider value={{ config, loading, error, retry }}>
      {children}
    </WorkflowConfigContext.Provider>
  );
}
