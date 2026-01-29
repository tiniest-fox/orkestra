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
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  error: "bg-error-100 text-error-700",
  info: "bg-info-100 text-info-700",
  blocked: "bg-warning-100 text-warning-700",
  neutral: "bg-stone-100 text-stone-600",
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
