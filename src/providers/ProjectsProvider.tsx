//! Context provider for the multi-project list and current project selection.
//!
//! Manages stored project configurations, migration from the legacy single-project
//! format, and populating display names from the daemon after first connection.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type Transport, useTransport } from "../transport";
import type { ProjectConfig, ProjectInfo } from "../types/project";
import {
  getCurrentProjectId,
  getProjectIdFromUrl,
  loadProjects,
  migrateFromLegacy,
  saveProjects,
  setCurrentProjectId,
  setProjectIdInUrl,
} from "../utils/projectStorage";

// ============================================================================
// Types
// ============================================================================

interface ProjectsContextValue {
  projects: ProjectConfig[];
  currentProject: ProjectConfig | null;
  addingProject: boolean;
  addProject: (config: ProjectConfig) => void;
  removeProject: (id: string) => void;
  switchProject: (id: string) => void;
  startAddProject: () => void;
  cancelAddProject: () => void;
}

// ============================================================================
// Context
// ============================================================================

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

/**
 * Access the projects context. Must be used within ProjectsProvider.
 */
export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) {
    throw new Error("useProjects must be used within ProjectsProvider");
  }
  return ctx;
}

// ============================================================================
// Helpers
// ============================================================================

async function fetchProjectInfo(
  transport: Transport,
): Promise<{ projectName: string; projectRoot: string }> {
  const info = await transport.call<ProjectInfo>("get_project_info");
  const projectName = info.project_root.split("/").pop() || info.project_root;
  return { projectName, projectRoot: info.project_root };
}

// ============================================================================
// Provider
// ============================================================================

interface ProjectsProviderProps {
  children: ReactNode;
}

export function ProjectsProvider({ children }: ProjectsProviderProps) {
  const transport = useTransport();

  // Initialize from localStorage, migrating legacy credentials if needed.
  const [projects, setProjects] = useState<ProjectConfig[]>(() => {
    migrateFromLegacy();
    return loadProjects();
  });

  // All current project ID changes trigger window.location.reload(), so we only
  // need the initial value — no state setter required.
  // Prefer the URL ?project= param (PWA multi-tab); fall back to localStorage.
  // Note: migrateFromLegacy() already ran in the projects initializer above.
  const [currentProjectId] = useState<string | null>(() => {
    const urlId = getProjectIdFromUrl();
    if (urlId && loadProjects().some((p) => p.id === urlId)) {
      // Use the URL project for this session without persisting it as the default.
      // Explicit switching (switchProject, addProject) is the only way to update
      // the stored default.
      return urlId;
    }
    const storedId = getCurrentProjectId();
    // Inject the stored default into the URL so it's self-contained and shareable.
    if (storedId) {
      setProjectIdInUrl(storedId);
    }
    return storedId;
  });

  const [addingProject, setAddingProject] = useState(false);

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  const addProject = useCallback(
    (config: ProjectConfig) => {
      const updated = [...projects, config];
      saveProjects(updated);
      setCurrentProjectId(config.id);
      setProjectIdInUrl(config.id);
      window.location.reload();
    },
    [projects],
  );

  const removeProject = useCallback(
    (id: string) => {
      const updated = projects.filter((p) => p.id !== id);
      saveProjects(updated);

      if (id === currentProjectId) {
        const nextId = updated.length > 0 ? updated[0].id : null;
        setCurrentProjectId(nextId);
        setProjectIdInUrl(nextId);
        window.location.reload();
      } else {
        // Non-current removal: update state in-place without reload.
        setProjects(updated);
      }
    },
    [currentProjectId, projects],
  );

  const switchProject = useCallback((id: string) => {
    setCurrentProjectId(id);
    setProjectIdInUrl(id);
    window.location.reload();
  }, []);

  const startAddProject = useCallback(() => {
    setAddingProject(true);
  }, []);

  const cancelAddProject = useCallback(() => {
    setAddingProject(false);
  }, []);

  // Populate projectName and projectRoot from the daemon after first connection.
  useEffect(() => {
    if (!currentProject || currentProject.projectName) return;

    fetchProjectInfo(transport)
      .then(({ projectName, projectRoot }) => {
        setProjects((prev) => {
          const updated = prev.map((p) =>
            p.id === currentProject.id ? { ...p, projectName, projectRoot } : p,
          );
          saveProjects(updated);
          return updated;
        });
      })
      .catch(() => {
        // Silent — we'll populate the name on the next successful connection.
      });
  }, [currentProject, transport]);

  const value: ProjectsContextValue = {
    projects,
    currentProject,
    addingProject,
    addProject,
    removeProject,
    switchProject,
    startAddProject,
    cancelAddProject,
  };

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}
