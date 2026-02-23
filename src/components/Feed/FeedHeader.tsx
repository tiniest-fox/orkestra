//! Top bar for the Feed view — logo, live task metrics, keyboard hint.

import { useMemo } from "react";
import type { WorkflowTaskView } from "../../types/workflow";
import { HotkeyButton } from "../ui/HotkeyButton";
import { HotkeyScope } from "../ui/HotkeyScope";

interface FeedHeaderProps {
  tasks: WorkflowTaskView[];
  onNewTask: () => void;
  hotkeyActive: boolean;
}

interface Metric {
  value: number;
  label: string;
  color: string;
}

export function FeedHeader({ tasks, onNewTask, hotkeyActive }: FeedHeaderProps) {
  const metrics = useMemo<Metric[]>(() => {
    const topLevel = tasks.filter((t) => !t.parent_id);
    const working = topLevel.filter((t) => t.derived.is_working).length;
    const review = topLevel.filter((t) => t.derived.needs_review).length;
    const questions = topLevel.filter((t) => t.derived.has_questions).length;
    const integrating = topLevel.filter((t) => t.state.type === "integrating").length;

    return [
      { value: working, label: "working", color: "var(--amber)" },
      { value: review, label: "review", color: "var(--accent)" },
      { value: questions, label: "questions", color: "var(--blue)" },
      { value: integrating, label: "integrating", color: "var(--accent-2)" },
    ].filter((m) => m.value > 0);
  }, [tasks]);

  return (
    <div className="flex items-center justify-between px-6 h-11 border-b border-[var(--border)] bg-white shrink-0">
      <div className="flex items-center gap-5">
        <span className="font-forge-sans text-[13px] font-bold tracking-[0.06em] uppercase text-[var(--text-0)] select-none">
          Orkestra
        </span>
        {metrics.length > 0 && (
          <div className="flex items-center gap-1 font-forge-mono text-[11px] text-[var(--text-2)]">
            {metrics.map((m, i) => (
              <span key={m.label} className="flex items-center gap-1">
                {i > 0 && <span className="text-[var(--text-3)] mx-0.5">·</span>}
                <span className="font-semibold" style={{ color: m.color }}>
                  {m.value}
                </span>
                <span>{m.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <HotkeyScope active={hotkeyActive}>
          <HotkeyButton
            hotkey="n"
            onClick={onNewTask}
            className="inline-flex items-center font-forge-sans text-[13px] font-semibold px-4 py-[7px] rounded-md border cursor-pointer transition-colors whitespace-nowrap leading-snug bg-transparent border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-bg)]"
          >
            New task
          </HotkeyButton>
        </HotkeyScope>
        <kbd className="font-forge-mono text-[10px] font-medium text-[var(--text-2)] bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 select-none">
          cmd+k
        </kbd>
      </div>
    </div>
  );
}
