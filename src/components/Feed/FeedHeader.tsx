// Top bar for the Feed view — logo, live task metrics, keyboard hint.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useProjects } from "../../providers";
import { useTransport } from "../../transport";
import type { WorkflowTaskView } from "../../types/workflow";
import { isActivelyProgressing } from "../../utils/taskStatus";
import { Button } from "../ui/Button";
import { HotkeyScope } from "../ui/HotkeyScope";
import { ProjectSwitcher } from "./ProjectSwitcher";

interface FeedHeaderProps {
  tasks: WorkflowTaskView[];
  onNewTask: () => void;
  onAssistant: () => void;
  hotkeyActive: boolean;
  assistantActive: boolean;
  serviceProjectName?: string;
  showHomeLink?: boolean;
}

interface Metric {
  value: number;
  label: string;
  colorClass: string;
}

export function FeedHeader({
  tasks,
  onNewTask,
  onAssistant,
  hotkeyActive,
  assistantActive,
  serviceProjectName,
  showHomeLink = false,
}: FeedHeaderProps) {
  const transport = useTransport();
  const { currentProject } = useProjects();
  const isMobile = useIsMobile();
  const metrics = useMemo<Metric[]>(() => {
    const topLevel = tasks.filter((t) => !t.parent_id);
    const working = topLevel.filter((t) => isActivelyProgressing(t)).length;
    const review = topLevel.filter((t) => t.derived.needs_review).length;
    const questions = topLevel.filter((t) => t.derived.has_questions).length;
    const integrating = topLevel.filter((t) => t.state.type === "integrating").length;

    return [
      { value: working, label: "working", colorClass: "text-status-warning" },
      { value: review, label: "review", colorClass: "text-accent" },
      { value: questions, label: "questions", colorClass: "text-status-info" },
      { value: integrating, label: "integrating", colorClass: "text-status-purple" },
    ].filter((m) => m.value > 0);
  }, [tasks]);

  return (
    <div className="shrink-0">
      <div className="flex items-center justify-between px-6 h-11 border-b border-border bg-surface">
        <div className="flex items-center gap-2">
          {showHomeLink ? (
            <Link
              to="/"
              className="font-sans text-[13px] font-bold tracking-[0.06em] uppercase text-text-primary select-none hover:text-text-secondary transition-colors"
            >
              Orkestra
            </Link>
          ) : (
            <span className="font-sans text-[13px] font-bold tracking-[0.06em] uppercase text-text-primary select-none">
              Orkestra
            </span>
          )}
          {serviceProjectName ? (
            <>
              <span className="text-text-quaternary select-none">·</span>
              <span className="text-[13px] font-medium text-text-secondary select-none">
                {serviceProjectName}
              </span>
            </>
          ) : (
            <>{transport.requiresAuthentication && currentProject && <ProjectSwitcher />}</>
          )}
          {!isMobile && metrics.length > 0 && (
            <>
              <span className="text-text-quaternary select-none">·</span>
              <div className="flex items-center gap-1 font-mono text-[11px] text-text-tertiary">
                {metrics.map((m, i) => (
                  <span key={m.label} className="flex items-center gap-1">
                    {i > 0 && <span className="text-text-quaternary mx-0.5">·</span>}
                    <span className={`font-semibold ${m.colorClass}`}>{m.value}</span>
                    <span>{m.label}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        {isMobile && (
          <span className="font-mono text-forge-mono-sm text-text-quaternary">
            {(import.meta.env.VITE_RELEASE_VERSION as string) ||
              (import.meta.env.VITE_COMMIT_HASH as string) ||
              "dev"}
          </span>
        )}
        {!isMobile && (
          <div className="flex items-center gap-2">
            <HotkeyScope active={hotkeyActive}>
              <Button hotkey="n" variant="primary" size="sm" onClick={onNewTask} onAccent>
                New Trak
              </Button>
              <Button
                hotkey="shift+a"
                variant="secondary"
                size="sm"
                onClick={onAssistant}
                onAccent={assistantActive}
                className={
                  assistantActive
                    ? "bg-accent/8 border-accent/35 text-accent hover:bg-accent/12"
                    : ""
                }
              >
                Assistant
              </Button>
            </HotkeyScope>
            <kbd className="font-mono text-[10px] font-medium text-text-tertiary bg-canvas border border-border rounded px-1.5 py-0.5 select-none">
              cmd+k
            </kbd>
          </div>
        )}
      </div>
    </div>
  );
}
