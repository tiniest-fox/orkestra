import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, FolderOpen, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RecentProject } from "../../types/project";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../ui/LoadingState";
import { Panel } from "../ui/Panel";

interface ProjectPickerProps {
  errorMessage?: string;
}

export function ProjectPicker({ errorMessage: initialError }: ProjectPickerProps) {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(initialError);

  const loadRecents = useCallback(async () => {
    try {
      const projects = await invoke<RecentProject[]>("get_recent_projects");
      setRecents(projects);
    } catch (err) {
      console.error("Failed to load recent projects:", err);
      setError(`Failed to load recent projects: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecents();
  }, [loadRecents]);

  async function handleOpenFolder() {
    try {
      const path = await invoke<string | null>("pick_folder");
      if (path) {
        await invoke("open_project", { path });
        // The command will create a new window, so this window's state is irrelevant after
      }
    } catch (err) {
      console.error("Failed to open project:", err);
      setError(`Failed to open project: ${String(err)}`);
    }
  }

  async function handleOpenRecent(project: RecentProject) {
    try {
      await invoke("open_project", { path: project.path });
      // The command will create a new window or focus existing
    } catch (err) {
      console.error("Failed to open project:", err);
      setError(`Failed to open ${project.display_name}: ${String(err)}`);
      // Reload recents in case path is no longer valid
      loadRecents();
    }
  }

  async function handleRemoveRecent(project: RecentProject, event: React.MouseEvent) {
    event.stopPropagation();
    try {
      const updated = await invoke<RecentProject[]>("remove_recent_project", {
        path: project.path,
      });
      setRecents(updated);
    } catch (err) {
      console.error("Failed to remove recent project:", err);
      setError(`Failed to remove ${project.display_name}: ${String(err)}`);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
      <Panel className="w-full max-w-2xl">
        <Panel.Header>
          <Panel.Title>Open Project</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          {error && (
            <div className="mb-4 rounded-md bg-error/10 px-4 py-3 text-sm text-error dark:bg-error/20">
              {error}
            </div>
          )}

          <div className="mb-6">
            <Button onClick={handleOpenFolder} className="w-full" size="lg">
              <FolderOpen className="mr-2 h-5 w-5" />
              Open Folder
            </Button>
          </div>

          {loading && <LoadingState message="Loading recent projects..." />}

          {!loading && recents.length === 0 && (
            <EmptyState
              icon={FolderOpen}
              message="No recent projects."
              description="Open a folder to get started."
            />
          )}

          {!loading && recents.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-medium text-stone-700 dark:text-stone-300">
                Recent Projects
              </h3>
              <div className="space-y-2">
                {recents.map((project) => (
                  <button
                    key={project.path}
                    type="button"
                    onClick={() => handleOpenRecent(project)}
                    className="group flex w-full items-center justify-between rounded-md border border-stone-200 bg-white px-4 py-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-orange-700 dark:hover:bg-orange-950/30"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-stone-900 dark:text-stone-100">
                        {project.display_name}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                        {project.path}
                      </div>
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => handleRemoveRecent(project, e)}
                        className="rounded p-1 text-stone-400 opacity-0 transition-all hover:bg-stone-100 hover:text-stone-600 group-hover:opacity-100 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                        aria-label={`Remove ${project.display_name} from recents`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <ChevronRight className="h-5 w-5 text-stone-400 transition-transform group-hover:translate-x-0.5 group-hover:text-orange-600 dark:group-hover:text-orange-400" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Panel.Body>
      </Panel>
    </div>
  );
}
