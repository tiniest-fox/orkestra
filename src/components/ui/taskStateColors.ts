/**
 * Canonical color definitions for task states.
 *
 * Each state has three class strings:
 * - `bg`: progress bar segment fill
 * - `badge`: badge background + text
 * - `icon`: icon wrapper background + icon text color
 */

export interface StateColorSet {
  /** Solid fill for progress bar segments. */
  bg: string;
  /** Light background + dark text for badges. */
  badge: string;
  /** Light background + dark icon color for icon indicators. */
  icon: string;
}

/** Color references for contexts requiring inline styles (e.g., accent gradients).
 *  Uses CSS variable references so values automatically adapt to dark mode.
 *  Tokens stored as space-separated RGB channels use rgb(var(--x)) notation. */
export const STATUS_HEX = {
  error: "rgb(var(--forge-status-error))",
  info: "rgb(var(--forge-status-info))",
  success: "rgb(var(--forge-status-success))",
  warning: "rgb(var(--forge-status-warning))",
  cyan: "var(--forge-status-cyan)",
  purple: "var(--forge-status-purple)",
  accent: "rgb(var(--forge-accent))",
  muted: "var(--forge-text-quaternary)",
  merge: "rgb(var(--forge-merge))",
} as const;

export const taskStateColors = {
  done: {
    bg: "bg-status-success",
    badge: "bg-status-success-bg text-status-success",
    icon: "bg-status-success-bg text-status-success",
  },
  working: {
    bg: "bg-accent",
    badge: "bg-accent-soft text-accent",
    icon: "bg-accent-soft text-accent",
  },
  questions: {
    bg: "bg-status-info",
    badge: "bg-status-info-bg text-status-info",
    icon: "bg-status-info-bg text-status-info",
  },
  review: {
    bg: "bg-status-warning",
    badge: "bg-status-warning-bg text-status-warning",
    icon: "bg-status-warning-bg text-status-warning",
  },
  blocked: {
    bg: "bg-status-warning",
    badge: "bg-status-warning-bg text-status-warning",
    icon: "bg-status-warning-bg text-status-warning",
  },
  failed: {
    bg: "bg-status-error",
    badge: "bg-status-error-bg text-status-error",
    icon: "bg-status-error-bg text-status-error",
  },
  waiting: {
    bg: "bg-stone-300 dark:bg-stone-600",
    badge: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
    icon: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400",
  },
  interrupted: {
    bg: "bg-amber-500 dark:bg-amber-600",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    icon: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
  },
  auto: {
    bg: "bg-purple-500 dark:bg-purple-600",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
    icon: "text-purple-500 dark:text-purple-400",
  },
  // PR states
  pr_open: {
    bg: "bg-purple-500 dark:bg-purple-600",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
    icon: "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400",
  },
  pr_merged: {
    bg: "bg-status-success",
    badge: "bg-status-success-bg text-status-success",
    icon: "bg-status-success-bg text-status-success",
  },
  pr_closed: {
    bg: "bg-status-error",
    badge: "bg-status-error-bg text-status-error",
    icon: "bg-status-error-bg text-status-error",
  },
  pr_unknown: {
    bg: "bg-stone-400 dark:bg-stone-600",
    badge: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
    icon: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400",
  },
} as const;

export type TaskState = keyof typeof taskStateColors;
