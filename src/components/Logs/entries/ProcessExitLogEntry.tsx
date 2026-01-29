/**
 * Process exit log entry - displays when the agent process exits.
 */

interface ProcessExitLogEntryProps {
  code?: number;
}

export function ProcessExitLogEntry({ code }: ProcessExitLogEntryProps) {
  return (
    <div className="py-2 my-2 text-center text-gray-500 text-xs border-t border-gray-700">
      Process exited{code !== undefined ? ` (code ${code})` : ""}
    </div>
  );
}
