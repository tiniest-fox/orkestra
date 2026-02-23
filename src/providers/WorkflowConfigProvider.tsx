/**
 * Provider for workflow configuration.
 * Loads config once on mount and blocks rendering until loaded.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { FeedLoadingSkeleton } from "../components/Feed/FeedLoadingSkeleton";
import { ErrorState } from "../components/ui";
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
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    invoke<WorkflowConfig>("workflow_get_config").then(setConfig).catch(setError);
  }, []);

  if (error != null) {
    return (
      <div className="flex items-center justify-center h-screen">
        <ErrorState message="Failed to load workflow config" error={error} />
      </div>
    );
  }

  if (!config) {
    return <FeedLoadingSkeleton />;
  }

  return <WorkflowConfigContext.Provider value={config}>{children}</WorkflowConfigContext.Provider>;
}
