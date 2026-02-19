//! Text symbol indicating task status with signal color and optional pulse.

import type { WorkflowTaskView } from "../../types/workflow";

interface StatusSymbolProps {
  task: WorkflowTaskView;
}

export function StatusSymbol({ task }: StatusSymbolProps) {
  const { derived, state } = task;

  let symbol: string;
  let color: string;
  let animation: string | undefined;

  if (derived.is_failed) {
    symbol = "!";
    color = "var(--red)";
  } else if (derived.has_questions) {
    symbol = "?";
    color = "var(--blue)";
  } else if (derived.needs_review) {
    symbol = ">";
    color = "var(--amber)";
  } else if (derived.is_working) {
    symbol = "*";
    color = "var(--amber)";
    animation = "forge-pulse-opacity 2.5s ease-in-out infinite";
  } else if (derived.is_done) {
    symbol = ".";
    color = "var(--green-dim)";
  } else if (derived.is_archived) {
    symbol = "-";
    color = "var(--text-3)";
  } else if (state.type === "integrating") {
    symbol = "\u25C7";
    color = "var(--accent-2)";
  } else {
    symbol = "~";
    color = "var(--text-3)";
  }

  return (
    <span
      className="w-[18px] text-center inline-block font-forge-mono text-sm font-semibold"
      style={{ color, animation }}
    >
      {symbol}
    </span>
  );
}
