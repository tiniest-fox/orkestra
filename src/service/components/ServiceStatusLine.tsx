// Bottom status bar — project count summary and keyboard hints (desktop only).

import { Kbd } from "../../components/ui/Kbd";
import { useIsMobile } from "../../hooks/useIsMobile";
import { categoryForStatus } from "../../utils/projectGrouping";
import type { Project } from "../api";

interface ServiceStatusLineProps {
  projects: Project[];
  modalOpen: boolean;
}

export function ServiceStatusLine({ projects, modalOpen }: ServiceStatusLineProps) {
  const isMobile = useIsMobile();

  if (isMobile) return null;

  const running = projects.filter((p) => categoryForStatus(p.status) === "running").length;
  const starting = projects.filter((p) => categoryForStatus(p.status) === "starting").length;
  const stopped = projects.filter((p) => categoryForStatus(p.status) === "stopped").length;
  const error = projects.filter((p) => categoryForStatus(p.status) === "error").length;

  const counts = [
    { value: running, label: "running", colorClass: "text-status-success" },
    { value: starting, label: "starting", colorClass: "text-status-warning" },
    { value: stopped, label: "stopped", colorClass: "text-text-quaternary" },
    { value: error, label: "error", colorClass: "text-status-error" },
  ].filter((c) => c.value > 0);

  return (
    <div className="flex items-center justify-between px-6 min-h-7 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] border-t border-border bg-surface shrink-0 font-mono text-forge-mono-sm text-text-tertiary">
      <div className="flex items-center gap-1">
        {counts.length === 0 && <span className="text-text-quaternary">No projects</span>}
        {counts.map((c, i) => (
          <span key={c.label} className="flex items-center gap-1">
            {i > 0 && <span className="text-text-quaternary mx-0.5">·</span>}
            <span className={`font-medium ${c.colorClass}`}>{c.value}</span>
            <span>{c.label}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {modalOpen ? (
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            <span>cancel</span>
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <Kbd>a</Kbd>
              <span>add</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>p</Kbd>
              <span>pair</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              <span>open</span>
            </span>
            <span className="text-text-quaternary">·</span>
            <span className="flex items-center gap-1.5">
              <Kbd>j/k</Kbd>
              <span>navigate</span>
            </span>
          </>
        )}
        <span className="text-text-quaternary">·</span>
        <span className="text-text-quaternary shrink-0">
          {(import.meta.env.VITE_RELEASE_VERSION as string) ||
            (import.meta.env.VITE_COMMIT_HASH as string) ||
            "dev"}
        </span>
      </div>
    </div>
  );
}
