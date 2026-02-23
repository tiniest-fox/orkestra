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

    // Fast path: startup-error arrived before React mounted.
    if (startupError.value) {
      setError(startupError.value);
      setLoading(false);
      return;
    }

    // Fast path: startup-data arrived before React mounted.
    if (startupData.value) {
      console.timeEnd("[startup] config");
      setConfig(startupData.value.config);
      setLoading(false);
      return;
    }

    // Slow path: wait for startup events that haven't arrived yet.
    let cancelled = false;

    const dataPromise = listen<StartupData>("startup-data", ({ payload }) => {
      if (cancelled) return;
      startupData.value = payload;
      console.timeEnd("[startup] config");
      setConfig(payload.config);
      setLoading(false);
    });

    const errorPromise = listen<{ message: string }>("startup-error", ({ payload }) => {
      if (cancelled) return;
      startupError.value = payload.message;
      setError(payload.message);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      dataPromise.then((unlisten) => unlisten());
      errorPromise.then((unlisten) => unlisten());
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
      dataPromise.then((unlisten) => unlisten());
      errorPromise.then((unlisten) => unlisten());
    });

    const errorPromise = listen<{ message: string }>("startup-error", ({ payload }) => {
      if (settled) return;
      settled = true;
      startupError.value = payload.message;
      setError(payload.message);
      setLoading(false);
      dataPromise.then((unlisten) => unlisten());
      errorPromise.then((unlisten) => unlisten());
    });

    invoke("workflow_retry_startup", { path }).catch((e: unknown) => {
      if (settled) return;
      settled = true;
      setError(e);
      setLoading(false);
      dataPromise.then((unlisten) => unlisten());
      errorPromise.then((unlisten) => unlisten());
    });
  }

  return (
    <WorkflowConfigContext.Provider value={{ config, loading, error, retry }}>
      {children}
    </WorkflowConfigContext.Provider>
  );
}
