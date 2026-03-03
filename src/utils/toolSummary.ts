/**
 * Shared tool input summary formatting for compact log display.
 */

import type { OrkAction, ToolInput } from "../types/workflow";
import { formatPath } from "./formatters";

/** One-line summary of a tool call's input for compact display. */
export function toolSummary(input: ToolInput): string {
  switch (input.tool) {
    case "bash":
      return input.command.slice(0, 120);
    case "read":
      return formatPath(input.file_path);
    case "write":
      return formatPath(input.file_path);
    case "edit":
      return formatPath(input.file_path);
    case "glob":
      return input.pattern;
    case "grep":
      return input.pattern;
    case "agent":
      return input.description ?? "";
    case "web_search":
      return input.query;
    case "web_fetch":
      return input.url;
    case "todo_write":
      return `${input.todos.length} item${input.todos.length !== 1 ? "s" : ""}`;
    case "ork":
      return orkSummary(input.ork_action);
    case "structured_output":
      return input.output_type ?? "";
    case "other":
      return input.summary ?? "";
    default:
      return "";
  }
}

export function orkSummary(action: OrkAction): string {
  switch (action.action) {
    case "complete":
      return `complete ${action.task_id}`;
    case "fail":
      return `fail ${action.task_id}`;
    case "block":
      return `block ${action.task_id}`;
    case "approve":
      return `approve ${action.task_id}`;
    case "create_subtask":
      return action.title ?? "";
    default:
      return action.action;
  }
}
