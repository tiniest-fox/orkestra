/**
 * Badge - Status indicator component.
 * Used for showing task status, review state, questions count, etc.
 */

import type { ReactNode } from "react";
import { type TaskState, taskStateColors } from "./taskStateColors";

type BadgeVariant = TaskState;

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = "waiting", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${taskStateColors[variant].badge} ${className}`}
    >
      {children}
    </span>
  );
}
