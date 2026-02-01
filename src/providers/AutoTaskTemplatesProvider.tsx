/**
 * Provider for auto-task templates.
 * Loads templates once on mount. Non-blocking — renders children immediately
 * with an empty list while loading (templates are optional UI chrome).
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { AutoTaskTemplate } from "../types/workflow";

const AutoTaskTemplatesContext = createContext<AutoTaskTemplate[]>([]);

/**
 * Access auto-task templates. Returns empty array if none loaded.
 */
export function useAutoTaskTemplates(): AutoTaskTemplate[] {
  return useContext(AutoTaskTemplatesContext);
}

interface AutoTaskTemplatesProviderProps {
  children: ReactNode;
}

export function AutoTaskTemplatesProvider({ children }: AutoTaskTemplatesProviderProps) {
  const [templates, setTemplates] = useState<AutoTaskTemplate[]>([]);

  useEffect(() => {
    invoke<AutoTaskTemplate[]>("workflow_get_auto_task_templates")
      .then(setTemplates)
      .catch((err) => {
        console.error("Failed to load auto-task templates:", err);
      });
  }, []);

  return (
    <AutoTaskTemplatesContext.Provider value={templates}>
      {children}
    </AutoTaskTemplatesContext.Provider>
  );
}
