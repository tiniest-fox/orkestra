//! Individual project card with status indicator, Open CTA for running projects, and overflow menu.
//! Applies optimistic status updates on action click; reverts on API error.

import { EllipsisVertical } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { Dropdown } from "../../components/ui/Dropdown";
import type { Project, ProjectStatus } from "../api";
import { rebuildProject, removeProject, startProject, stopProject } from "../api";

// ============================================================================
// Types
// ============================================================================

interface ProjectCardProps {
  project: Project;
  onRefresh: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

const TRANSITIONING: ProjectStatus[] = [
  "cloning",
  "starting",
  "stopping",
  "rebuilding",
  "removing",
];

function isTransitioning(status: ProjectStatus): boolean {
  return TRANSITIONING.includes(status);
}

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

export function ProjectCard({ project, onRefresh }: ProjectCardProps) {
  const [optimisticStatus, setOptimisticStatus] = useState<ProjectStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const status = optimisticStatus ?? project.status;
  const busy = optimisticStatus !== null;

  const canStart = status === "stopped" || status === "error";
  const canStop = status === "running" || status === "starting";
  const canRebuild = status === "running" || status === "error" || status === "stopped";

  async function runAction(optimistic: ProjectStatus, action: () => Promise<void>) {
    setActionError(null);
    setOptimisticStatus(optimistic);
    try {
      await action();
      setOptimisticStatus(null);
      onRefresh();
    } catch (e) {
      setOptimisticStatus(null);
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemove() {
    if (!window.confirm(`Remove project "${project.name}"? This cannot be undone.`)) return;
    await runAction("removing", () => removeProject(project.id));
  }

  return (
    <div className="bg-surface border border-border rounded-panel-sm p-3 mb-2">
      {/* -- Header row -- */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(status)}`} />
        <span
          className="font-semibold text-text-primary flex-1 min-w-0 truncate"
          title={project.name}
        >
          {project.name}
        </span>
        <span className="text-xs text-text-secondary whitespace-nowrap">{statusLabel(status)}</span>
        {status === "running" && (
          <Link to={`/project/${project.id}`}>
            <Button variant="primary" size="sm">
              Open
            </Button>
          </Link>
        )}
        <Dropdown
          align="right"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={({ onClick }) => (
            <button
              type="button"
              onClick={onClick}
              disabled={busy || isTransitioning(status)}
              aria-label="Project actions"
              className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <EllipsisVertical className="w-4 h-4" />
            </button>
          )}
        >
          {canStart && (
            <Dropdown.Item
              onClick={() => {
                setMenuOpen(false);
                runAction("starting", () => startProject(project.id));
              }}
            >
              Start
            </Dropdown.Item>
          )}
          {canStop && (
            <Dropdown.Item
              onClick={() => {
                setMenuOpen(false);
                runAction("stopping", () => stopProject(project.id));
              }}
            >
              Stop
            </Dropdown.Item>
          )}
          {canRebuild && (
            <Dropdown.Item
              onClick={() => {
                setMenuOpen(false);
                runAction("rebuilding", () => rebuildProject(project.id));
              }}
            >
              Rebuild
            </Dropdown.Item>
          )}
          <Dropdown.Item
            onClick={() => {
              setMenuOpen(false);
              handleRemove();
            }}
            className="text-status-error"
          >
            Remove
          </Dropdown.Item>
        </Dropdown>
      </div>

      {/* -- Error message from project -- */}
      {project.status === "error" && project.error_message && !actionError && (
        <div className="mt-2 text-xs bg-status-error-bg text-status-error rounded-panel-sm p-2 break-words">
          {project.error_message}
        </div>
      )}

      {/* -- Inline action error -- */}
      {actionError && (
        <div className="mt-2 text-xs bg-status-error-bg text-status-error rounded-panel-sm p-2 break-words">
          {actionError}
        </div>
      )}
    </div>
  );
}
