// Resource limits drawer for viewing and editing per-project CPU and memory limits.

import { Button } from "../../components/ui";
import { Drawer } from "../../components/ui/Drawer/Drawer";
import { DrawerHeader } from "../../components/ui/Drawer/DrawerHeader";
import type { ProjectStatus } from "../api";
import { useResourceLimits } from "./useResourceLimits";

// ============================================================================
// Types
// ============================================================================

interface ResourceLimitsDrawerProps {
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectStatus: ProjectStatus;
}

// ============================================================================
// Component
// ============================================================================

export function ResourceLimitsDrawer({
  onClose,
  projectId,
  projectName,
  projectStatus,
}: ResourceLimitsDrawerProps) {
  const {
    limits,
    loading,
    saving,
    error,
    restartRequired,
    cpuInput,
    setCpuInput,
    memoryInput,
    setMemoryInput,
    save,
    reset,
  } = useResourceLimits(projectId, projectStatus);

  return (
    <Drawer onClose={onClose}>
      <div className="flex flex-col h-full">
        <DrawerHeader title={`Resource Limits — ${projectName}`} onClose={onClose} />

        {/* Restart notice banner */}
        {restartRequired && projectStatus === "running" && (
          <div className="px-4 py-2 border-b border-border bg-status-warning/10 text-forge-body text-text-primary">
            Limits have been modified. Restart the project to apply changes.
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="px-4 py-2 border-b border-border bg-status-error/10 text-forge-body text-status-error">
            {error}
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {loading ? (
            <div className="text-forge-body text-text-tertiary">Loading…</div>
          ) : (
            <>
              {/* CPU input */}
              <div className="flex flex-col gap-1">
                <label htmlFor="cpu-limit" className="text-forge-mono-sm text-text-secondary">
                  CPU Limit
                </label>
                <input
                  id="cpu-limit"
                  type="text"
                  value={cpuInput}
                  onChange={(e) => setCpuInput(e.target.value)}
                  placeholder={`Default: ${limits?.effective_cpu ?? "—"}`}
                  className="w-full px-3 py-1.5 rounded-panel-sm border border-border bg-canvas font-mono text-forge-mono-sm text-text-primary focus:outline-none focus:border-accent"
                />
                <div className="text-forge-mono-label text-text-quaternary">
                  Cores (e.g. 2.0). Leave blank for default.
                </div>
              </div>

              {/* Memory input */}
              <div className="flex flex-col gap-1">
                <label htmlFor="memory-limit" className="text-forge-mono-sm text-text-secondary">
                  Memory Limit
                </label>
                <input
                  id="memory-limit"
                  type="text"
                  value={memoryInput}
                  onChange={(e) => setMemoryInput(e.target.value)}
                  placeholder={`Default: ${limits?.effective_memory_mb != null ? `${limits.effective_memory_mb}MB` : "—"}`}
                  className="w-full px-3 py-1.5 rounded-panel-sm border border-border bg-canvas font-mono text-forge-mono-sm text-text-primary focus:outline-none focus:border-accent"
                />
                <div className="text-forge-mono-label text-text-quaternary">
                  Megabytes (e.g. 4096). Leave blank for default.
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="primary" onClick={save} disabled={saving} loading={saving}>
                  Save
                </Button>
                <Button variant="secondary" onClick={reset} disabled={saving}>
                  Reset to Defaults
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
