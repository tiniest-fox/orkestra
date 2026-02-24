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

/** Raw hex values for contexts requiring inline styles (e.g., accent gradients).
 *  Must stay in sync with `status.*` tokens in tailwind.config.js. */
export const STATUS_HEX = {
  error: "#DC2626",
  info: "#2563EB",
  success: "#16A34A",
  warning: "#D97706",
  cyan: "#0891b2",
  purple: "#9333ea",
  accent: "#E83558",
  muted: "#9E96AC",
  merge: "#C85A4C",
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
    bg: "bg-stone-300",
    badge: "bg-stone-100 text-stone-600",
    icon: "bg-stone-100 text-stone-500",
  },
  interrupted: {
    bg: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700",
    icon: "bg-amber-100 text-amber-600",
  },
  auto: {
    bg: "bg-purple-500",
    badge: "bg-purple-100 text-purple-700",
    icon: "text-purple-500",
  },
  // PR states
  pr_open: {
    bg: "bg-purple-500",
    badge: "bg-purple-100 text-purple-700",
    icon: "bg-purple-100 text-purple-600",
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
    bg: "bg-stone-400",
    badge: "bg-stone-100 text-stone-600",
    icon: "bg-stone-100 text-stone-500",
  },
} as const;

export type TaskState = keyof typeof taskStateColors;
