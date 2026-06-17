// Text symbol indicating task status with signal color, background chip, and optional pulse.

import {
  AlertTriangle,
  Circle,
  CircleCheck,
  CircleX,
  Clock,
  GitCompareArrows,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PrStatus, SyncStatus, WorkflowTaskView } from "../../types/workflow";
import { hasConflicts } from "../../utils/prStatus";
import { isActivelyProgressing } from "../../utils/taskStatus";

interface StatusSymbolProps {
  task: WorkflowTaskView;
  /** When true, renders a dotted-circle waiting indicator instead of the task's derived status. */
  waiting?: boolean;
  prStatus?: PrStatus;
  syncStatus?: SyncStatus;
}

interface StatusColors {
  bg: string;
  icon: string;
}

const TRANSPARENT = "bg-transparent";
const PR_ICON_SIZE = 14;

type PrHealth =
  | "conflicts"
  | "changes_requested"
  | "failing"
  | "approved"
  | "pending"
  | "passing"
  | "open";

function derivePrHealth(prStatus: PrStatus): PrHealth {
  if (hasConflicts(prStatus)) {
    return "conflicts";
  }
  if (prStatus.reviews.some((r) => r.state === "CHANGES_REQUESTED")) {
    return "changes_requested";
  }
  const meaningful = prStatus.checks.filter((c) => c.status !== "skipped");
  if (meaningful.some((c) => c.status === "failure")) return "failing";
  if (prStatus.reviews.some((r) => r.state === "APPROVED")) {
    return "approved";
  }
  if (meaningful.some((c) => c.status === "pending")) return "pending";
  if (meaningful.some((c) => c.status === "success")) return "passing";
  return "open";
}

function resolveColors(
  task: WorkflowTaskView,
  prStatus: PrStatus | undefined,
  syncStatus: SyncStatus | undefined,
): {
  colors: StatusColors;
  symbol: string | ReactNode;
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
        symbol: "‖",
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
    return { colors: { bg: "bg-accent-soft", icon: "text-accent" }, symbol: "‖", extraClass };
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
    if (prStatus?.state === "merged") {
      return {
        colors: { bg: "bg-status-success-bg", icon: "text-status-success" },
        symbol: "✓",
        extraClass,
      };
    }
    if (prStatus?.state === "closed") {
      return {
        colors: { bg: "bg-status-warning-bg", icon: "text-status-warning" },
        symbol: "✕",
        extraClass,
      };
    }
    if (task.pr_url && prStatus) {
      const health = derivePrHealth(prStatus);
      if (health === "conflicts") {
        return {
          colors: { bg: "bg-status-warning-bg", icon: "text-status-warning" },
          symbol: <AlertTriangle data-testid="icon-conflicts" size={PR_ICON_SIZE} />,
          extraClass,
        };
      }
      if ((syncStatus?.ahead ?? 0) > 0) {
        return {
          colors: { bg: "bg-status-info-bg", icon: "text-status-info" },
          symbol: <GitCompareArrows data-testid="icon-needs-push" size={PR_ICON_SIZE} />,
          extraClass,
        };
      }
      switch (health) {
        case "changes_requested":
          return {
            colors: { bg: "bg-status-error-bg", icon: "text-status-error" },
            symbol: <ShieldX data-testid="icon-changes-requested" size={PR_ICON_SIZE} />,
            extraClass,
          };
        case "failing":
          return {
            colors: { bg: "bg-status-error-bg", icon: "text-status-error" },
            symbol: <CircleX data-testid="icon-failing" size={PR_ICON_SIZE} />,
            extraClass,
          };
        case "approved":
          return {
            colors: { bg: "bg-status-success-bg", icon: "text-status-success" },
            symbol: <ShieldCheck data-testid="icon-approved" size={PR_ICON_SIZE} />,
            extraClass,
          };
        case "pending":
          return {
            colors: { bg: "bg-status-warning-bg", icon: "text-status-warning" },
            symbol: <Clock data-testid="icon-pending" size={PR_ICON_SIZE} />,
            extraClass,
          };
        case "passing":
          return {
            colors: { bg: "bg-status-success-bg", icon: "text-status-success" },
            symbol: <CircleCheck data-testid="icon-passing" size={PR_ICON_SIZE} />,
            extraClass,
          };
        case "open":
          return {
            colors: { bg: TRANSPARENT, icon: "text-text-quaternary" },
            symbol: <Circle data-testid="icon-open" size={PR_ICON_SIZE} />,
            extraClass,
          };
      }
    }
    if (task.pr_url) {
      // PR exists but status not yet fetched
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
    return { colors: { bg: "bg-accent-soft", icon: "text-accent" }, symbol: "◇", extraClass };
  }
  const idleSymbol = task.is_chat ? "◉" : "~";
  return {
    colors: { bg: TRANSPARENT, icon: "text-text-quaternary" },
    symbol: idleSymbol,
    extraClass,
  };
}

export function StatusSymbol({ task, waiting, prStatus, syncStatus }: StatusSymbolProps) {
  const activePrStatus = task.derived.is_done && task.pr_url ? prStatus : undefined;
  const activeSyncStatus = task.derived.is_done && task.pr_url ? syncStatus : undefined;
  const { colors, symbol, extraClass } = waiting
    ? {
        colors: { bg: "bg-transparent", icon: "text-text-tertiary" },
        symbol: "◌",
        extraClass: "",
      }
    : resolveColors(task, activePrStatus, activeSyncStatus);

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
