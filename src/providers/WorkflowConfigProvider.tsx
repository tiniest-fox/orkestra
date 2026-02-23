/**
 * Provider for workflow configuration.
 * Always renders children immediately — callers must check loading/error state.
 * Orkestra is the single gate that decides what to show based on both this
 * and TasksProvider loading state.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { WorkflowConfig } from "../types/workflow";

interface WorkflowConfigState {
  config: WorkflowConfig | null;
  loading: boolean;
  error: unknown;
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

export function WorkflowConfigProvider({ children }: WorkflowConfigProviderProps) {
  const [config, setConfig] = useState<WorkflowConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    console.timeEnd("[startup] config:react");
    console.time("[startup] config:ipc");
    invoke<WorkflowConfig>("workflow_get_config")
      .then((c) => {
        console.timeEnd("[startup] config:ipc");
        console.timeEnd("[startup] config");
        setConfig(c);
        setLoading(false);
      })
      .catch((e) => {
        console.timeEnd("[startup] config:ipc");
        console.timeEnd("[startup] config");
        setError(e);
        setLoading(false);
      });
  }, []);

  return (
    <WorkflowConfigContext.Provider value={{ config, loading, error }}>
      {children}
    </WorkflowConfigContext.Provider>
  );
}
