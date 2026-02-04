/**
 * Individual result rows in the command palette.
 *
 * CommandPaletteResult: task/subtask search result with status indicator.
 * CommandPaletteAction: action command (e.g. "New Task") with icon.
 */

import {
  AlertCircle,
  CheckCircle,
  Circle,
  CircleDot,
  Eye,
  Layers,
  MessageCircle,
  Plus,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { TaskState } from "../ui/taskStateColors";
import { taskStateColors } from "../ui/taskStateColors";
import type { PaletteAction } from "./useActionSearch";
import type { SearchResult } from "./useTaskSearch";

interface CommandPaletteResultProps {
  result: SearchResult;
  isActive: boolean;
  onClick: () => void;
}

/** Map a task's derived state to a TaskState for color + icon. */
function deriveVisualState(result: SearchResult): {
  state: TaskState;
  label: string;
  icon: ReactNode;
} {
  const { derived, status } = result.task;

  if (derived.is_failed) {
    return {
      state: "failed",
      label: "Failed",
      icon: <XCircle className="w-3.5 h-3.5" />,
    };
  }
  if (derived.is_blocked) {
    return {
      state: "blocked",
      label: "Blocked",
      icon: <AlertCircle className="w-3.5 h-3.5" />,
    };
  }
  if (derived.is_done || derived.is_archived) {
    return {
      state: "done",
      label: "Done",
      icon: <CheckCircle className="w-3.5 h-3.5" />,
    };
  }
  if (derived.has_questions) {
    return {
      state: "questions",
      label: "Questions",
      icon: <MessageCircle className="w-3.5 h-3.5" />,
    };
  }
  if (derived.needs_review) {
    return {
      state: "review",
      label: "Review",
      icon: <Eye className="w-3.5 h-3.5" />,
    };
  }
  if (derived.is_waiting_on_children) {
    return {
      state: "waiting",
      label: "Subtasks",
      icon: <Layers className="w-3.5 h-3.5" />,
    };
  }
  if (derived.is_working) {
    return {
      state: "working",
      label: status.type === "active" ? status.stage : "Working",
      icon: <CircleDot className="w-3.5 h-3.5" />,
    };
  }
  return {
    state: "waiting",
    label: "Idle",
    icon: <Circle className="w-3.5 h-3.5" />,
  };
}

function getDisplayTitle(result: SearchResult): string {
  const { task } = result;
  if (task.title) return task.title;
  const maxLength = 80;
  if (task.description.length <= maxLength) return task.description;
  return `${task.description.slice(0, maxLength)}...`;
}

export function CommandPaletteResult({ result, isActive, onClick }: CommandPaletteResultProps) {
  const { state, label, icon } = deriveVisualState(result);
  const isSubtask = !!result.task.parent_id;
  const colors = taskStateColors[state];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
        isActive
          ? "bg-orange-50 dark:bg-orange-950"
          : "hover:bg-stone-50 dark:hover:bg-stone-800/50"
      }`}
    >
      {/* Status icon */}
      <span className={`flex-shrink-0 p-1 rounded-md ${colors.icon}`}>{icon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm truncate ${isActive ? "text-stone-900 dark:text-stone-50" : "text-stone-700 dark:text-stone-200"}`}
          >
            {isSubtask && result.task.short_id && (
              <span className="text-stone-400 dark:text-stone-500 font-mono text-xs mr-1.5">
                {result.task.short_id}
              </span>
            )}
            {getDisplayTitle(result)}
          </span>
        </div>

        {/* Subtitle: parent context for subtasks, or ID for top-level */}
        <div className="flex items-center gap-2 mt-0.5">
          {isSubtask && result.parent ? (
            <span className="text-xs text-stone-400 dark:text-stone-500 truncate">
              {result.parent.title || result.parent.id}
            </span>
          ) : (
            <span className="text-xs text-stone-400 dark:text-stone-500 font-mono">
              {result.task.id}
            </span>
          )}
        </div>
      </div>

      {/* Status badge */}
      <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full ${colors.badge}`}>
        {label}
      </span>
    </button>
  );
}

// =============================================================================
// Action result
// =============================================================================

interface CommandPaletteActionProps {
  action: PaletteAction;
  isActive: boolean;
  onClick: () => void;
}

export function CommandPaletteAction({ action, isActive, onClick }: CommandPaletteActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
        isActive
          ? "bg-orange-50 dark:bg-orange-950"
          : "hover:bg-stone-50 dark:hover:bg-stone-800/50"
      }`}
    >
      <span className="flex-shrink-0 p-1 rounded-md text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950">
        <Plus className="w-3.5 h-3.5" />
      </span>
      <span
        className={`text-sm ${isActive ? "text-stone-900 dark:text-stone-50" : "text-stone-700 dark:text-stone-200"}`}
      >
        {action.label}
      </span>
      <span className="flex-shrink-0 ml-auto text-xs px-2 py-0.5 rounded-full text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800">
        Action
      </span>
    </button>
  );
}
