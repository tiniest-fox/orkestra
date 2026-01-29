/**
 * Text log entry - plain text output from the assistant.
 */

interface TextLogEntryProps {
  content: string;
}

export function TextLogEntry({ content }: TextLogEntryProps) {
  return <div className="py-1 text-gray-100 text-sm whitespace-pre-wrap">{content}</div>;
}
