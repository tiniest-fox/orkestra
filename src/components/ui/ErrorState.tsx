import { AlertCircle, type LucideIcon } from "lucide-react";

/**
 * A centered error state display with an icon, message, and optional description.
 * Used across the app for consistent error state styling.
 */
interface ErrorStateProps {
  /** The lucide-react icon component to display. Defaults to AlertCircle. */
  icon?: LucideIcon;
  /** Primary message (e.g. "Failed to load logs") */
  message: string;
  /** Optional secondary description */
  description?: string;
  /** Additional className for the wrapper */
  className?: string;
}

export function ErrorState({
  icon: Icon = AlertCircle,
  message,
  description,
  className = "",
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-8 ${className}`}>
      <Icon className="w-8 h-8 text-error-300 dark:text-error-600" />
      <p className="text-sm text-error-500 dark:text-error-400 mt-3 text-center">{message}</p>
      {description && (
        <p className="text-xs text-error-400 dark:text-error-500 mt-1 text-center">{description}</p>
      )}
    </div>
  );
}
