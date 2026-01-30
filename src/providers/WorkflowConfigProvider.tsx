/**
 * Provider for workflow configuration.
 * Loads config once on mount and blocks rendering until loaded.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { WorkflowConfig } from "../types/workflow";

const WorkflowConfigContext = createContext<WorkflowConfig | null>(null);

/**
 * Access workflow configuration. Guaranteed non-null when used inside WorkflowConfigProvider.
 */
export function useWorkflowConfig(): WorkflowConfig {
  const ctx = useContext(WorkflowConfigContext);
  if (!ctx) {
    throw new Error("useWorkflowConfig must be used within WorkflowConfigProvider");
  }
  return ctx;
}

interface WorkflowConfigProviderProps {
  children: ReactNode;
}

export function WorkflowConfigProvider({ children }: WorkflowConfigProviderProps) {
  const [config, setConfig] = useState<WorkflowConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<WorkflowConfig>("workflow_get_config")
      .then(setConfig)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-error-700 dark:text-error-300 text-sm">
          Failed to load workflow config: {error}
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-stone-500 dark:text-stone-400 text-sm">
          Loading workflow configuration...
        </div>
      </div>
    );
  }

  return <WorkflowConfigContext.Provider value={config}>{children}</WorkflowConfigContext.Provider>;
}
