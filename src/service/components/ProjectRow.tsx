// Individual project row with focus treatment, status dot, action buttons, and overflow menu.
// Action state (optimistic status, error) is lifted to the parent; this component is pure display.

import { EllipsisVertical } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../components/ui";
import { Dropdown } from "../../components/ui/Dropdown";
import { HotkeyScope } from "../../components/ui/HotkeyScope";
import { useNavItem } from "../../components/ui/NavigationScope";
import { useIsMobile } from "../../hooks/useIsMobile";
import { categoryForStatus } from "../../utils/projectGrouping";
import type { Project, ProjectStatus } from "../api";
import { ProjectLatestLog } from "./ProjectLatestLog";
import { ProjectLogsModal } from "./ProjectLogsModal";

// ============================================================================
// Types
// ============================================================================

export interface ProjectRowActions {
  effectiveStatus: ProjectStatus;
  busy: boolean;
  actionError: string | null;
  onStart: () => void;
  onStop: () => void;
  onRebuild: () => void;
  onRemove: () => void;
  onOpen: () => void;
  onGitFetch: () => void;
  onGitPull: () => void;
  onGitPush: () => void;
  onCancel: () => void;
}

export interface ProjectRowProps extends ProjectRowActions {
  project: Project;
  isFocused: boolean;
  onMouseEnter: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function statusLabel(status: ProjectStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    case "cloning":
      return "Cloning...";
    case "starting":
      return "Starting...";
    case "stopping":
      return "Stopping...";
    case "rebuilding":
      return "Rebuilding...";
    case "removing":
      return "Removing...";
  }
}

function statusDotClass(status: ProjectStatus): string {
  if (status === "running") return "bg-status-success";
  if (status === "stopped") return "bg-surface-3";
  if (status === "error") return "bg-status-error";
  // transitioning states
  return "bg-status-warning animate-[forge-pulse-opacity_1.2s_ease-in-out_infinite]";
}

// ============================================================================
// Component
// ============================================================================

export function ProjectRow({
  project,
  effectiveStatus,
  busy,
  actionError,
  onStart,
  onStop,
  onRebuild,
  onRemove,
  onOpen,
  onGitFetch,
  onGitPull,
  onGitPush,
  onCancel,
  isFocused,
  onMouseEnter,
}: ProjectRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const isMobile = useIsMobile();

  useNavItem(project.id, rowRef);

  const cat = categoryForStatus(effectiveStatus);
  const transitioning = cat === "starting" || (cat === "stopped" && effectiveStatus !== "stopped");
  const cancellable =
    effectiveStatus === "starting" ||
    effectiveStatus === "rebuilding" ||
    effectiveStatus === "cloning";
  const canStart = effectiveStatus === "stopped" || effectiveStatus === "error";
  const canRebuild =
    effectiveStatus === "running" || effectiveStatus === "error" || effectiveStatus === "stopped";

  const showProjectError = project.status === "error" && project.error_message && !actionError;

  return (
    <div>
      {/* -- Row -- */}
      {/* biome-ignore lint/a11y/useSemanticElements: grid layout requires div; role+tabIndex+onKeyDown provide accessibility */}
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        onMouseEnter={onMouseEnter}
        onClick={() => {
          if (effectiveStatus === "running") onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            if (effectiveStatus === "running") onOpen();
          }
        }}
        className={`w-full text-left grid grid-cols-[24px_minmax(0,1fr)_auto_auto] gap-4 px-6 py-2 ${isMobile ? "min-h-[48px]" : "min-h-[40px]"} items-center border-l-2 transition-[background-color,border-color] duration-100 ease-out cursor-default ${
          !isMobile && isFocused
            ? "bg-accent-soft border-l-accent"
            : "border-l-transparent hover:bg-canvas"
        }`}
      >
        {/* Col 1: Status dot */}
        <div className="flex items-center justify-center">
          <span className={`w-2 h-2 rounded-full ${statusDotClass(effectiveStatus)}`} />
        </div>

        {/* Col 2: Name + status label */}
        <div className="min-w-0">
          <div
            className="font-sans text-forge-body font-medium tracking-[-0.01em] truncate text-text-primary"
            title={project.name}
          >
            {project.name}
          </div>
          {project.git_status && (
            <div className="flex items-center gap-1.5 font-mono text-forge-mono-label text-text-quaternary">
              <span
                className="text-accent truncate max-w-[120px]"
                title={project.git_status.branch}
              >
                {project.git_status.branch}
              </span>
              {project.git_status.sync_status && project.git_status.sync_status.ahead > 0 && (
                <span
                  className="text-text-tertiary"
                  title={`${project.git_status.sync_status.ahead} ahead`}
                >
                  ↑{project.git_status.sync_status.ahead}
                </span>
              )}
              {project.git_status.sync_status && project.git_status.sync_status.behind > 0 && (
                <span
                  className="text-text-tertiary"
                  title={`${project.git_status.sync_status.behind} behind`}
                >
                  ↓{project.git_status.sync_status.behind}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Col 3: Inline actions */}
        <HotkeyScope active={isFocused}>
          <div className="flex items-center gap-2">
            {effectiveStatus === "running" && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen();
                  }}
                >
                  Open
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStop();
                  }}
                >
                  Stop
                </Button>
              </>
            )}
            {canStart && !transitioning && (
              <Button
                variant="primary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onStart();
                }}
              >
                Start
              </Button>
            )}
            {transitioning && !isMobile && (
              <span className="font-mono text-forge-mono-label text-text-quaternary truncate min-w-0">
                <ProjectLatestLog projectId={project.id} fallback={statusLabel(effectiveStatus)} />
              </span>
            )}
          </div>
        </HotkeyScope>

        {/* Col 4: Overflow menu */}
        <Dropdown
          align="right"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={({ onClick }) => (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              disabled={busy}
              aria-label="Project actions"
              className="p-2 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <EllipsisVertical className="w-4 h-4" />
            </button>
          )}
        >
          {!transitioning && project.status !== "cloning" && (
            <>
              <Dropdown.Item
                onClick={() => {
                  setMenuOpen(false);
                  onGitFetch();
                }}
              >
                Fetch
              </Dropdown.Item>
              <Dropdown.Item
                onClick={() => {
                  setMenuOpen(false);
                  onGitPull();
                }}
              >
                Pull
                {project.git_status?.sync_status && project.git_status.sync_status.behind > 0
                  ? ` ↓${project.git_status.sync_status.behind}`
                  : ""}
              </Dropdown.Item>
              <Dropdown.Item
                onClick={() => {
                  setMenuOpen(false);
                  onGitPush();
                }}
              >
                Push
                {project.git_status?.sync_status && project.git_status.sync_status.ahead > 0
                  ? ` ↑${project.git_status.sync_status.ahead}`
                  : ""}
              </Dropdown.Item>
            </>
          )}
          {!transitioning && canRebuild && (
            <Dropdown.Item
              onClick={() => {
                setMenuOpen(false);
                onRebuild();
              }}
            >
              Rebuild
            </Dropdown.Item>
          )}
          {cancellable && (
            <Dropdown.Item
              onClick={() => {
                setMenuOpen(false);
                onCancel();
              }}
            >
              Cancel
            </Dropdown.Item>
          )}
          <Dropdown.Item
            onClick={() => {
              setMenuOpen(false);
              setLogsOpen(true);
            }}
          >
            View Logs
          </Dropdown.Item>
          <Dropdown.Item
            onClick={() => {
              setMenuOpen(false);
              onRemove();
            }}
            className="text-status-error"
          >
            Remove
          </Dropdown.Item>
        </Dropdown>
      </div>

      {/* -- Mobile log row -- */}
      {isMobile && transitioning && (
        <div className="px-6 pb-1 pl-[calc(1.5rem+24px+1rem)] font-mono text-forge-mono-label text-text-quaternary truncate">
          <ProjectLatestLog projectId={project.id} fallback={statusLabel(effectiveStatus)} />
        </div>
      )}

      {/* -- Error strip -- */}
      {(actionError || showProjectError) && (
        <div className="px-6 py-1">
          <div className="text-xs bg-status-error-bg text-status-error rounded-panel-sm p-2 break-words">
            {actionError ?? project.error_message}
          </div>
        </div>
      )}

      <ProjectLogsModal
        isOpen={logsOpen}
        onClose={() => setLogsOpen(false)}
        projectId={project.id}
        projectName={project.name}
      />
    </div>
  );
}
