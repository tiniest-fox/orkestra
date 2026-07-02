// Directory picker dialog — lists top-level subdirectories and creates a subfolder project on selection.

import { useEffect, useState } from "react";
import { LoadingState, Panel } from "../../components/ui";
import { DrawerHeader } from "../../components/ui/Drawer/DrawerHeader";
import { extractErrorMessage } from "../../utils/errors";
import { addSubfolderProject, listDirectories } from "../api";

// ============================================================================
// Types
// ============================================================================

interface SubfolderPickerProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onComplete: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function SubfolderPicker({
  projectId,
  projectName,
  onClose,
  onComplete,
}: SubfolderPickerProps) {
  const [directories, setDirectories] = useState<string[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDirectories(projectId)
      .then(setDirectories)
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setHasLoaded(true));
  }, [projectId]);

  const handleSelect = async (dir: string) => {
    setCreating(dir);
    setError(null);
    try {
      await addSubfolderProject(projectId, dir, dir);
      onComplete();
    } catch (err) {
      setError(extractErrorMessage(err));
      setCreating(null);
    }
  };

  return (
    <Panel autoFill={false}>
      <DrawerHeader title={`Open Subfolder — ${projectName}`} onClose={onClose} />
      <div className="p-4 flex-1 overflow-auto max-h-[60vh]">
        {!hasLoaded ? (
          <LoadingState message="Loading directories..." />
        ) : directories.length === 0 && !error ? (
          <p className="text-sm text-text-secondary text-center py-4">No subdirectories found.</p>
        ) : (
          <div className="max-h-[280px] overflow-y-auto -mx-4 px-4">
            {directories.map((dir) => (
              <button
                key={dir}
                type="button"
                disabled={creating !== null}
                className="w-full text-left flex items-center gap-4 px-2 py-2 rounded-panel-sm hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleSelect(dir)}
                onKeyDown={() => {}}
              >
                <span className="text-sm font-medium text-text-primary truncate">{dir}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
        {creating && !error && (
          <p className="mt-2 text-xs text-text-secondary">Creating project for "{creating}"...</p>
        )}
      </div>
    </Panel>
  );
}
