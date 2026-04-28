// Text symbol indicating task status with signal color, background chip, and optional pulse.

import type { PrStatus, WorkflowTaskView } from "../../types/workflow";
import { isActivelyProgressing } from "../../utils/taskStatus";

interface StatusSymbolProps {
  task: WorkflowTaskView;
  /** When true, renders a dotted-circle waiting indicator instead of the task's derived status. */
  waiting?: boolean;
  prStatus?: PrStatus;
}

interface StatusColors {
  bg: string;
  icon: string;
}

const TRANSPARENT = "bg-transparent";

function resolveColors(
  task: WorkflowTaskView,
  prState: string | undefined,
): {
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
  if (isActivelyProgressing(task) || derived.assistant_active) {
    extraClass = "animate-spin-bounce";
    if (task.auto_mode) {
      return {
        colors: { bg: "bg-status-purple-bg", icon: "text-status-purple" },
        symbol: "ϟ",
        extraClass,
      };
    }
    return { colors: { bg: "bg-accent-soft", icon: "text-accent" }, symbol: "*", extraClass };
  }
  if (derived.is_done) {
    if (prState === "merged") {
      return {
        colors: { bg: "bg-status-success-bg", icon: "text-status-success" },
        symbol: "✓",
        extraClass,
      };
    }
    if (prState === "closed") {
      return {
        colors: { bg: "bg-status-warning-bg", icon: "text-status-warning" },
        symbol: "✕",
        extraClass,
      };
    }
    if (task.pr_url) {
      // PR exists but not merged/closed — it's open
      return {
        colors: { bg: "bg-status-success-bg", icon: "text-status-success" },
        symbol: "↑",
        extraClass,
      };
    }
    // No PR yet
    return {
      colors: { bg: "bg-status-success-bg", icon: "text-status-success" },
      symbol: "○",
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
  const idleSymbol = task.is_chat ? "◉" : "~";
  return {
    colors: { bg: TRANSPARENT, icon: "text-text-quaternary" },
    symbol: idleSymbol,
    extraClass,
  };
}

export function StatusSymbol({ task, waiting, prStatus }: StatusSymbolProps) {
  const prState = task.derived.is_done && task.pr_url ? prStatus?.state : undefined;
  const { colors, symbol, extraClass } = waiting
    ? {
        colors: { bg: "bg-transparent", icon: "text-text-tertiary" },
        symbol: "\u25CC",
        extraClass: "",
      }
    : resolveColors(task, prState);

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
