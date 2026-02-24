import { Inbox, type LucideIcon } from "lucide-react";

/**
 * A centered empty state display with an icon, message, and optional description.
 * Used across the app for consistent empty state styling.
 */
interface EmptyStateProps {
  /** The lucide-react icon component to display. Defaults to Inbox. */
  icon?: LucideIcon;
  /** Primary message (e.g. "No subtasks.") */
  message: string;
  /** Optional secondary description */
  description?: string;
  /** Additional className for the wrapper */
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  message,
  description,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-8 ${className}`}>
      <Icon className="w-8 h-8 text-text-quaternary" />
      <p className="text-sm text-text-tertiary mt-3 text-center">{message}</p>
      {description && <p className="text-xs text-text-tertiary mt-1 text-center">{description}</p>}
    </div>
  );
}
