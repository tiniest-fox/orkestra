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
  success: "bg-emerald-100 text-success",
  warning: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-error",
  info: "bg-blue-100 text-info",
  blocked: "bg-orange-100 text-blocked",
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
