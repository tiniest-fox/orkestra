/**
 * Context provider for project info — fetches once on mount and shares across the tree.
 *
 * Replaces the per-component useProjectInfo() hook with a context-based approach.
 * Multiple components in the drawer tree can call useProjectInfo() without triggering
 * independent fetches.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { ProjectInfo } from "../types/project";

const ProjectInfoContext = createContext<ProjectInfo | null>(null);

/**
 * Access project info. Must be used within ProjectInfoProvider.
 * Returns null until the fetch completes (or if it fails).
 */
export function useProjectInfo(): ProjectInfo | null {
  return useContext(ProjectInfoContext);
}

interface ProjectInfoProviderProps {
  children: ReactNode;
}

export function ProjectInfoProvider({ children }: ProjectInfoProviderProps) {
  const [info, setInfo] = useState<ProjectInfo | null>(null);

  useEffect(() => {
    invoke<ProjectInfo>("get_project_info")
      .then(setInfo)
      .catch(() => {}); // Silent — features that need run script just won't show
  }, []);

  return <ProjectInfoContext.Provider value={info}>{children}</ProjectInfoContext.Provider>;
}
