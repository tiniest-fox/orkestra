/**
 * Log entry view - maps log entry types to their renderers.
 */

import type { LogEntry } from "../../types/workflow";
import { ErrorLogEntry } from "./entries/ErrorLogEntry";
import { ProcessExitLogEntry } from "./entries/ProcessExitLogEntry";
import { ScriptExitLogEntry } from "./entries/ScriptExitLogEntry";
import { ScriptOutputLogEntry } from "./entries/ScriptOutputLogEntry";
import { ScriptStartLogEntry } from "./entries/ScriptStartLogEntry";
import { SubagentToolUseLogEntry } from "./entries/SubagentToolUseLogEntry";
import { TextLogEntry } from "./entries/TextLogEntry";
import { ToolResultLogEntry } from "./entries/ToolResultLogEntry";
import { ToolUseLogEntry } from "./entries/ToolUseLogEntry";
import { UserMessageLogEntry } from "./entries/UserMessageLogEntry";

interface LogEntryViewProps {
  entry: LogEntry;
}

export function LogEntryView({ entry }: LogEntryViewProps) {
  switch (entry.type) {
    case "text":
      return <TextLogEntry content={entry.content} />;

    case "user_message":
      return <UserMessageLogEntry content={entry.content} resumeType={entry.resume_type} />;

    case "tool_use":
      return <ToolUseLogEntry tool={entry.tool} input={entry.input} />;

    case "tool_result":
      return <ToolResultLogEntry tool={entry.tool} content={entry.content} />;

    case "subagent_tool_use":
      return <SubagentToolUseLogEntry tool={entry.tool} input={entry.input} />;

    case "subagent_tool_result":
      // Skip most subagent results, they're verbose
      return null;

    case "process_exit":
      return <ProcessExitLogEntry code={entry.code} />;

    case "error":
      return <ErrorLogEntry message={entry.message} />;

    case "script_start":
      return <ScriptStartLogEntry command={entry.command} stage={entry.stage} />;

    case "script_output":
      return <ScriptOutputLogEntry content={entry.content} />;

    case "script_exit":
      return (
        <ScriptExitLogEntry code={entry.code} success={entry.success} timedOut={entry.timed_out} />
      );

    default:
      return null;
  }
}
