/**
 * ProjectPicker - UI for selecting a project to open.
 *
 * Shown when a window has no `project` query parameter.
 * Displays an "Open Folder" button and a list of recently opened projects.
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Clock, FolderOpen, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RecentProject } from "../../types/project";
import { formatRelativeTime } from "../../utils/formatters";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Panel } from "../ui/Panel/Panel";

interface RecentProjectCardProps {
  project: RecentProject;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

/**
 * Card for a single recent project entry.
 */
function RecentProjectCard({ project, onOpen, onRemove }: RecentProjectCardProps) {
  return (
    <Panel as="button" className="text-left" onClick={() => onOpen(project.path)}>
      <div className="p-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-stone-900 dark:text-stone-100 mb-1">
            {project.display_name}
          </div>
          <div className="text-sm text-stone-500 dark:text-stone-400 truncate mb-1">
            {project.path}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-stone-400 dark:text-stone-500">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatRelativeTime(project.last_opened)}</span>
          </div>
        </div>
        <IconButton
          icon={<X />}
          aria-label="Remove from recent projects"
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(project.path);
          }}
        />
      </div>
    </Panel>
  );
}

export function ProjectPicker() {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecentProjects = useCallback(async () => {
    try {
      const projects = await invoke<RecentProject[]>("get_recent_projects");
      setRecentProjects(projects);
    } catch (err) {
      console.error("Failed to load recent projects:", err);
      // Non-fatal - just show empty list
    }
  }, []);

  // Load recent projects on mount
  useEffect(() => {
    loadRecentProjects();
  }, [loadRecentProjects]);

  // Check for error query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get("error");
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
    }
  }, []);

  async function handleOpenFolder() {
    try {
      setIsLoading(true);
      setError(null);

      // Open native folder picker
      const path = await invoke<string | null>("pick_folder");
      if (!path) {
        // User cancelled
        setIsLoading(false);
        return;
      }

      // Open the selected project
      await invoke("open_project", { path });

      // Close the picker window after successful project open
      await getCurrentWindow().close();
    } catch (err) {
      setIsLoading(false);
      setError(String(err));
    }
  }

  async function handleOpenRecent(path: string) {
    try {
      setIsLoading(true);
      setError(null);

      await invoke("open_project", { path });

      // Close the picker window after successful project open
      await getCurrentWindow().close();
    } catch (err) {
      setIsLoading(false);
      setError(String(err));
    }
  }

  const handleRemoveRecent = useCallback(
    async (path: string) => {
      try {
        await invoke("remove_recent_project", { path });
        // Refresh the list
        await loadRecentProjects();
      } catch (err) {
        console.error("Failed to remove recent project:", err);
        setError(String(err));
      }
    },
    [loadRecentProjects],
  );

  return (
    <div className="h-screen bg-stone-100 dark:bg-stone-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Error banner */}
        {error && (
          <div className="mb-4 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-error-800 dark:text-error-200 text-sm flex-1">{error}</p>
              <IconButton
                icon={<X />}
                aria-label="Dismiss error"
                size="sm"
                variant="ghost"
                onClick={() => setError(null)}
              />
            </div>
          </div>
        )}

        <Panel className="p-8">
          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-heading font-bold text-stone-900 dark:text-stone-100 mb-2">
              Orkestra
            </h1>
            <p className="text-stone-500 dark:text-stone-400">Select a project to get started</p>
          </div>

          {/* Open Folder button */}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={isLoading}
            onClick={handleOpenFolder}
            className="mb-8"
          >
            <FolderOpen className="w-5 h-5 mr-2" />
            Open Folder
          </Button>

          {/* Recent projects */}
          {recentProjects.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300 mb-3">
                Recent Projects
              </h2>
              <div className="space-y-2">
                {recentProjects.map((project) => (
                  <RecentProjectCard
                    key={project.path}
                    project={project}
                    onOpen={handleOpenRecent}
                    onRemove={handleRemoveRecent}
                  />
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
