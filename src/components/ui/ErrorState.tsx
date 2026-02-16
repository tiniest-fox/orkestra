import { AlertCircle, type LucideIcon } from "lucide-react";
import { extractErrorMessage } from "../../utils/errors";

/**
 * A centered error state display with an icon, message, and optional description.
 * Used across the app for consistent error state styling.
 *
 * Accepts either explicit `message`/`description` strings or a raw `error` object
 * (e.g. Tauri's { code, message }). When `error` is provided:
 * - If `message` is also set, the extracted error text becomes the `description`.
 * - If `message` is omitted, the extracted error text becomes the `message`.
 */
interface ErrorStateProps {
  /** The lucide-react icon component to display. Defaults to AlertCircle. */
  icon?: LucideIcon;
  /** Primary message (e.g. "Failed to load logs") */
  message?: string;
  /** Optional secondary description */
  description?: string;
  /** Raw error object — message is extracted automatically. */
  error?: unknown;
  /** Additional className for the wrapper */
  className?: string;
}

export function ErrorState({
  icon: Icon = AlertCircle,
  message,
  description,
  error,
  className = "",
}: ErrorStateProps) {
  let resolvedMessage = message;
  let resolvedDescription = description;

  if (error != null) {
    const extracted = extractErrorMessage(error);
    if (resolvedMessage) {
      resolvedDescription ??= extracted;
    } else {
      resolvedMessage = extracted;
    }
  }

  resolvedMessage ??= "Something went wrong";

  return (
    <div className={`flex flex-col items-center justify-center py-8 ${className}`}>
      <Icon className="w-8 h-8 text-error-300 dark:text-error-600" />
      <p className="text-sm text-error-500 dark:text-error-400 mt-3 text-center">
        {resolvedMessage}
      </p>
      {resolvedDescription && (
        <p className="text-xs text-error-400 dark:text-error-500 mt-1 text-center max-w-md">
          {resolvedDescription}
        </p>
      )}
    </div>
  );
}
