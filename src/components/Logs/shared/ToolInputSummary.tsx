/**
 * Tool input summary - displays a concise summary of tool input.
 */

import type { OrkAction, TodoItem, ToolInput } from "../../../types/workflow";
import { formatPath } from "../../../utils/formatters";
import { getStructuredOutputStyle } from "../../../utils/toolStyling";

interface ToolInputSummaryProps {
  input: ToolInput;
}

export function ToolInputSummary({ input }: ToolInputSummaryProps) {
  switch (input.tool) {
    case "bash":
      return (
        <code className="text-emerald-300 text-xs font-mono break-all">
          {input.command.slice(0, 100)}
          {input.command.length > 100 && "..."}
        </code>
      );
    case "read":
      return <span className="text-blue-300 text-xs">{formatPath(input.file_path)}</span>;
    case "write":
      return <span className="text-amber-300 text-xs">{formatPath(input.file_path)}</span>;
    case "edit":
      return <span className="text-purple-300 text-xs">{formatPath(input.file_path)}</span>;
    case "glob":
      return <span className="text-cyan-300 text-xs">{input.pattern}</span>;
    case "grep":
      return <span className="text-cyan-300 text-xs">{input.pattern}</span>;
    case "task":
      return <span className="text-pink-300 text-xs">{input.description}</span>;
    case "todo_write":
      return <TodoDisplay todos={input.todos} />;
    case "ork":
      return <OrkActionDisplay action={input.ork_action} />;
    case "structured_output": {
      const style = getStructuredOutputStyle(input.output_type);
      return <span className={`${style.textColor} text-xs`}>{style.label}</span>;
    }
    case "other":
      return <span className="text-gray-400 text-xs">{input.summary}</span>;
    default:
      return null;
  }
}

function TodoDisplay({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="text-xs space-y-0.5">
      {todos.map((todo, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: todos are display-only without stable IDs
        <div key={i} className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              todo.status === "completed"
                ? "bg-green-400"
                : todo.status === "in_progress"
                  ? "bg-blue-400"
                  : "bg-gray-400"
            }`}
          />
          <span className="text-gray-300">{todo.content}</span>
        </div>
      ))}
    </div>
  );
}

function OrkActionDisplay({ action }: { action: OrkAction }) {
  const getActionText = () => {
    switch (action.action) {
      case "complete":
        return `Complete ${action.task_id}${action.summary ? `: ${action.summary}` : ""}`;
      case "fail":
        return `Fail ${action.task_id}${action.reason ? `: ${action.reason}` : ""}`;
      case "block":
        return `Block ${action.task_id}${action.reason ? `: ${action.reason}` : ""}`;
      case "approve":
        return `Approve ${action.task_id}`;
      case "set_plan":
        return `Set plan for ${action.task_id}`;
      case "approve_review":
        return `Approve review ${action.task_id}`;
      case "reject_review":
        return `Reject review ${action.task_id}${action.feedback ? `: ${action.feedback}` : ""}`;
      case "create_subtask":
        return `Create subtask: ${action.title}`;
      case "set_breakdown":
        return `Set breakdown for ${action.task_id}`;
      case "approve_breakdown":
        return `Approve breakdown ${action.task_id}`;
      case "skip_breakdown":
        return `Skip breakdown ${action.task_id}`;
      case "complete_subtask":
        return `Complete subtask ${action.subtask_id}`;
      case "other":
        return action.raw;
      default:
        return "Unknown action";
    }
  };

  return <span className="text-orange-300 text-xs">{getActionText()}</span>;
}
