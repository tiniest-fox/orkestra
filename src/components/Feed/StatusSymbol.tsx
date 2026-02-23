//! Text symbol indicating task status with signal color, background chip, and optional pulse.

import type { WorkflowTaskView } from "../../types/workflow";

interface StatusSymbolProps {
  task: WorkflowTaskView;
}

export function StatusSymbol({ task }: StatusSymbolProps) {
  const { derived, state } = task;

  let symbol: string;
  let color: string;
  let bgColor: string;
  let extraClass = "";

  if (derived.is_waiting_on_children && derived.subtask_progress) {
    const p = derived.subtask_progress;
    if (p.failed > 0) {
      symbol = "!";
      color = "var(--red)";
      bgColor = "var(--red-bg)";
    } else if (p.has_questions > 0) {
      symbol = "?";
      color = "var(--blue)";
      bgColor = "var(--blue-bg)";
    } else if (p.needs_review > 0) {
      symbol = "⦿";
      color = "var(--violet)";
      bgColor = "var(--violet-bg)";
    } else if (p.working > 0) {
      symbol = "*";
      color = "var(--accent-2)";
      bgColor = "var(--accent-2-bg)";
      extraClass = "animate-spin-bounce";
    } else {
      symbol = "~";
      color = "var(--text-3)";
      bgColor = "transparent";
    }
  } else if (derived.is_failed) {
    symbol = "!";
    color = "var(--red)";
    bgColor = "var(--red-bg)";
  } else if (derived.has_questions) {
    symbol = "?";
    color = "var(--blue)";
    bgColor = "var(--blue-bg)";
  } else if (derived.needs_review) {
    symbol = "⦿";
    color = "var(--violet)";
    bgColor = "var(--violet-bg)";
  } else if (derived.is_working) {
    symbol = "*";
    color = "var(--accent-2)";
    bgColor = "var(--accent-2-bg)";
    extraClass = "animate-spin-bounce";
  } else if (derived.is_done) {
    symbol = "✓";
    color = "var(--peach)";
    bgColor = "var(--peach-bg)";
  } else if (derived.is_archived) {
    symbol = "-";
    color = "var(--text-3)";
    bgColor = "transparent";
  } else if (state.type === "integrating") {
    symbol = "\u25C7";
    color = "var(--accent-2)";
    bgColor = "var(--accent-2-bg)";
  } else {
    symbol = "~";
    color = "var(--text-3)";
    bgColor = "transparent";
  }

  return (
    <span
      className="w-[24px] h-[24px] flex items-center justify-center rounded-[4px] shrink-0 self-start"
      style={{ backgroundColor: bgColor }}
    >
      <span
        className={`text-center inline-block font-forge-mono text-[18px] font-semibold ${extraClass}`}
        style={{ color }}
      >
        {symbol}
      </span>
    </span>
  );
}
