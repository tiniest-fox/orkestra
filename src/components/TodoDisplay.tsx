import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { TodoItem } from "../types/task";

interface TodoDisplayProps {
  todos: TodoItem[];
}

export function TodoDisplay({ todos }: TodoDisplayProps) {
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const total = todos.length;

  return (
    <div className="mt-1 pl-4 text-xs">
      <div className="text-gray-400 mb-1">
        {completed}/{total} completed
        {inProgress > 0 && ` (${inProgress} in progress)`}
      </div>
      <div className="space-y-0.5 max-h-32 overflow-y-auto">
        {todos.map((todo, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: todos have no stable IDs
            key={index}
            className="flex items-start gap-1.5"
          >
            {todo.status === "completed" ? (
              <CheckCircle2 size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
            ) : todo.status === "in_progress" ? (
              <Loader2 size={12} className="text-blue-400 mt-0.5 flex-shrink-0 animate-spin" />
            ) : (
              <Circle size={12} className="text-gray-500 mt-0.5 flex-shrink-0" />
            )}
            <span
              className={
                todo.status === "completed"
                  ? "text-gray-500 line-through"
                  : todo.status === "in_progress"
                    ? "text-blue-300"
                    : "text-gray-400"
              }
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
