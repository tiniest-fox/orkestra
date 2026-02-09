/**
 * Text log entry - markdown-formatted output from the assistant.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PROSE_CLASSES_DARK } from "../../../utils";

interface TextLogEntryProps {
  content: string;
}

export function TextLogEntry({ content }: TextLogEntryProps) {
  return (
    <div className={`py-1 text-sm ${PROSE_CLASSES_DARK}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
