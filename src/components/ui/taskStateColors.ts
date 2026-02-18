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

export const taskStateColors = {
  done: {
    bg: "bg-success-500 dark:bg-success-400",
    badge: "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300",
    icon: "bg-success-100 dark:bg-success-900 text-success-600 dark:text-success-300",
  },
  working: {
    bg: "bg-orange-400 dark:bg-orange-500",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    icon: "bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300",
  },
  questions: {
    bg: "bg-info-400 dark:bg-info-500",
    badge: "bg-info-100 text-info-700 dark:bg-info-900 dark:text-info-300",
    icon: "bg-info-100 dark:bg-info-900 text-info-600 dark:text-info-300",
  },
  review: {
    bg: "bg-warning-400 dark:bg-warning-500",
    badge: "bg-warning-100 text-warning-700 dark:bg-warning-900 dark:text-warning-300",
    icon: "bg-warning-100 dark:bg-warning-900 text-warning-700 dark:text-warning-300",
  },
  blocked: {
    bg: "bg-warning-300 dark:bg-warning-600",
    badge: "bg-warning-100 text-warning-700 dark:bg-warning-900 dark:text-warning-300",
    icon: "bg-warning-100 dark:bg-warning-900 text-warning-600 dark:text-warning-300",
  },
  failed: {
    bg: "bg-error-500 dark:bg-error-400",
    badge: "bg-error-100 text-error-700 dark:bg-error-900 dark:text-error-300",
    icon: "bg-error-100 dark:bg-error-900 text-error-600 dark:text-error-300",
  },
  waiting: {
    bg: "bg-stone-300 dark:bg-stone-600",
    badge: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
    icon: "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
  },
  interrupted: {
    bg: "bg-amber-500 dark:bg-amber-600",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    icon: "bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-300",
  },
  auto: {
    bg: "bg-purple-500 dark:bg-purple-400",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    icon: "text-purple-500 dark:text-purple-400",
  },
  // PR states
  pr_open: {
    bg: "bg-purple-500 dark:bg-purple-400",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    icon: "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300",
  },
  pr_merged: {
    bg: "bg-success-500 dark:bg-success-400",
    badge: "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300",
    icon: "bg-success-100 dark:bg-success-900 text-success-600 dark:text-success-300",
  },
  pr_closed: {
    bg: "bg-error-500 dark:bg-error-400",
    badge: "bg-error-100 text-error-700 dark:bg-error-900 dark:text-error-300",
    icon: "bg-error-100 dark:bg-error-900 text-error-600 dark:text-error-300",
  },
  pr_unknown: {
    bg: "bg-stone-400 dark:bg-stone-500",
    badge: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
    icon: "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
  },
} as const;

export type TaskState = keyof typeof taskStateColors;
