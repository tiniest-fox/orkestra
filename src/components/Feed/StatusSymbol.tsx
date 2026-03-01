//! Text symbol indicating task status with signal color, background chip, and optional pulse.

import type { WorkflowTaskView } from "../../types/workflow";
import { isActivelyProgressing } from "../../utils/taskStatus";

interface StatusSymbolProps {
  task: WorkflowTaskView;
  /** When true, renders a dotted-circle waiting indicator instead of the task's derived status. */
  waiting?: boolean;
}

interface StatusColors {
  bg: string;
  icon: string;
}

const TRANSPARENT = "bg-transparent";

function resolveColors(task: WorkflowTaskView): {
  colors: StatusColors;
  symbol: string;
  extraClass: string;
} {
  const { derived, state } = task;
  let extraClass = "";

  if (derived.is_waiting_on_children && derived.subtask_progress) {
    const p = derived.subtask_progress;
    if (p.failed > 0 || p.blocked > 0) {
      return {
        colors: { bg: "bg-status-error-bg", icon: "text-status-error" },
        symbol: "!",
        extraClass,
      };
    }
    if (p.interrupted > 0) {
      return {
        colors: { bg: "bg-accent-soft", icon: "text-accent" },
        symbol: "\u2016",
        extraClass,
      };
    }
    if (p.has_questions > 0) {
      return {
        colors: { bg: "bg-status-info-bg", icon: "text-status-info" },
        symbol: "?",
        extraClass,
      };
    }
    if (p.needs_review > 0) {
      return {
        colors: { bg: "bg-status-purple-bg", icon: "text-status-purple" },
        symbol: "⦿",
        extraClass,
      };
    }
    if (p.working > 0) {
      extraClass = "animate-spin-bounce";
      return { colors: { bg: "bg-accent-soft", icon: "text-accent" }, symbol: "*", extraClass };
    }
    return { colors: { bg: TRANSPARENT, icon: "text-text-quaternary" }, symbol: "~", extraClass };
  }

  if (derived.is_failed || derived.is_blocked) {
    return {
      colors: { bg: "bg-status-error-bg", icon: "text-status-error" },
      symbol: "!",
      extraClass,
    };
  }
  if (derived.has_questions) {
    return {
      colors: { bg: "bg-status-info-bg", icon: "text-status-info" },
      symbol: "?",
      extraClass,
    };
  }
  if (derived.needs_review) {
    return {
      colors: { bg: "bg-status-purple-bg", icon: "text-status-purple" },
      symbol: "⦿",
      extraClass,
    };
  }
  if (derived.is_interrupted) {
    return { colors: { bg: "bg-accent-soft", icon: "text-accent" }, symbol: "\u2016", extraClass };
  }
  if (isActivelyProgressing(task)) {
    extraClass = "animate-spin-bounce";
    if (task.auto_mode) {
      return {
        colors: { bg: "bg-purple-100", icon: "text-purple-500" },
        symbol: "ϟ",
        extraClass,
      };
    }
    return { colors: { bg: "bg-accent-soft", icon: "text-accent" }, symbol: "*", extraClass };
  }
  if (derived.is_done) {
    return {
      colors: { bg: "bg-status-success-bg", icon: "text-status-success" },
      symbol: "✓",
      extraClass,
    };
  }
  if (derived.is_archived) {
    return { colors: { bg: TRANSPARENT, icon: "text-text-quaternary" }, symbol: "-", extraClass };
  }
  if (state.type === "integrating") {
    extraClass = "animate-spin-bounce";
    return { colors: { bg: "bg-accent-soft", icon: "text-accent" }, symbol: "\u25C7", extraClass };
  }
  return { colors: { bg: TRANSPARENT, icon: "text-text-quaternary" }, symbol: "~", extraClass };
}

export function StatusSymbol({ task, waiting }: StatusSymbolProps) {
  const { colors, symbol, extraClass } = waiting
    ? {
        colors: { bg: "bg-transparent", icon: "text-text-tertiary" },
        symbol: "\u25CC",
        extraClass: "",
      }
    : resolveColors(task);

  return (
    <span
      className={`w-[24px] h-[24px] flex items-center justify-center rounded-[4px] shrink-0 self-start ${colors.bg}`}
    >
      <span
        className={`text-center inline-block font-mono text-[18px] font-semibold ${colors.icon} ${extraClass}`}
      >
        {symbol}
      </span>
    </span>
  );
}
