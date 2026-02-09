/**
 * Error log entry - displays error messages.
 */

interface ErrorLogEntryProps {
  message: string;
}

export function ErrorLogEntry({ message }: ErrorLogEntryProps) {
  return (
    <div className="py-2 px-3 my-2 bg-red-100 dark:bg-red-900/30 border-l-2 border-red-400 dark:border-red-500 rounded-r">
      <div className="text-xs text-red-600 dark:text-red-400 mb-1">Error</div>
      <div className="text-red-700 dark:text-red-300 text-sm">{message}</div>
    </div>
  );
}
