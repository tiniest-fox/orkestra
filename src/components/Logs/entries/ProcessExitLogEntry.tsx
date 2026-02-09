/**
 * Process exit log entry - displays when the agent process exits.
 */

interface ProcessExitLogEntryProps {
  code?: number;
}

export function ProcessExitLogEntry({ code }: ProcessExitLogEntryProps) {
  return (
    <div className="py-2 my-2 text-center text-stone-400 dark:text-stone-500 text-xs border-t border-stone-300 dark:border-stone-700">
      Process exited{code !== undefined ? ` (code ${code})` : ""}
    </div>
  );
}
