/**
 * Error log entry - displays error messages.
 */

interface ErrorLogEntryProps {
  message: string;
}

export function ErrorLogEntry({ message }: ErrorLogEntryProps) {
  return (
    <div className="py-2 px-3 my-2 bg-error-100 dark:bg-error-900/30 border-l-2 border-error-400 dark:border-error-500 rounded-r">
      <div className="text-xs text-error-600 dark:text-error-400 mb-1">Error</div>
      <div className="text-error-700 dark:text-error-300 text-sm">{message}</div>
    </div>
  );
}
