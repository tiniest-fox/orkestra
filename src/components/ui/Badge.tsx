/**
 * Badge - Status indicator component.
 * Used for showing task status, review state, questions count, etc.
 */

import type { ReactNode } from "react";

type BadgeVariant = "success" | "warning" | "error" | "info" | "blocked" | "neutral";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300",
  warning: "bg-warning-100 text-warning-700 dark:bg-warning-900 dark:text-warning-300",
  error: "bg-error-100 text-error-700 dark:bg-error-900 dark:text-error-300",
  info: "bg-info-100 text-info-700 dark:bg-info-900 dark:text-info-300",
  blocked: "bg-warning-100 text-warning-700 dark:bg-warning-900 dark:text-warning-300",
  neutral: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
};

export function Badge({ children, variant = "neutral", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
