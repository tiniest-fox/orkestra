/**
 * Shared tool input summary formatting for compact log display.
 */

import type { OrkAction, ToolInput } from "../types/workflow";
import { formatPath } from "./formatters";

/** One-line summary of a tool call's input for compact display. */
export function toolSummary(input: ToolInput, projectRoot?: string): string {
  switch (input.tool) {
    case "bash":
      return input.command.slice(0, 120);
    case "read":
      return formatPath(input.file_path, projectRoot);
    case "write":
      return formatPath(input.file_path, projectRoot);
    case "edit":
      return formatPath(input.file_path, projectRoot);
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
    case "other":
      return input.summary ?? "";
    default:
      return "";
  }
}

/**
 * Joins multiple tool summaries into a compact string.
 * When all paths share the same parent directory, strips the common prefix
 * from all but the first entry: "dir/a.ts, b.ts, c.ts" instead of "dir/a.ts, dir/b.ts, dir/c.ts".
 */
export function compactGroupSummary(summaries: string[]): string {
  if (summaries.length <= 1) return summaries[0] ?? "";

  const dirOf = (p: string) => {
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(0, idx + 1) : "";
  };

  const dirs = summaries.map(dirOf);
  const commonDir = dirs[0];

  if (commonDir && dirs.every((d) => d === commonDir)) {
    const rest = summaries.slice(1).map((p) => p.slice(commonDir.length));
    return [summaries[0], ...rest].join(", ");
  }

  return summaries.join(", ");
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
