/**
 * Color references for task states and status indicators.
 */

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
