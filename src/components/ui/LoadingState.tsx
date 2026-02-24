/**
 * A centered loading state display with a spinner, message, and optional description.
 * Used across the app for consistent loading state styling.
 */
interface LoadingStateProps {
  /** Primary message (e.g. "Loading logs...") */
  message: string;
  /** Optional secondary description */
  description?: string;
  /** Additional className for the wrapper */
  className?: string;
}

export function LoadingState({ message, description, className = "" }: LoadingStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-8 ${className}`}>
      <span className="w-8 h-8 border-2 border-border border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-text-tertiary mt-3 text-center">{message}</p>
      {description && <p className="text-xs text-text-tertiary mt-1 text-center">{description}</p>}
    </div>
  );
}
