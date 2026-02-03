/**
 * Tool styling utilities for log entries.
 * Consolidated lookup for tool icons, colors, and structured output styles.
 */

import {
  AlertCircle,
  Command,
  FileOutput,
  FilePlus,
  FileText,
  FolderSearch,
  GitBranch,
  Globe,
  HelpCircle,
  ListTodo,
  MessageCircle,
  Network,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Terminal,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

interface ToolStyle {
  icon: (size: number) => ReactNode;
  color: string;
}

const ICON_PROPS = { strokeWidth: 2.5 };

/**
 * Tool style lookup table.
 */
const TOOL_STYLES: Record<string, ToolStyle> = {
  bash: {
    icon: (size) => <Terminal size={size} {...ICON_PROPS} />,
    color: "bg-emerald-600",
  },
  read: {
    icon: (size) => <FileText size={size} {...ICON_PROPS} />,
    color: "bg-blue-600",
  },
  write: {
    icon: (size) => <FilePlus size={size} {...ICON_PROPS} />,
    color: "bg-amber-600",
  },
  edit: {
    icon: (size) => <Pencil size={size} {...ICON_PROPS} />,
    color: "bg-indigo-600",
  },
  glob: {
    icon: (size) => <FolderSearch size={size} {...ICON_PROPS} />,
    color: "bg-cyan-600",
  },
  grep: {
    icon: (size) => <Search size={size} {...ICON_PROPS} />,
    color: "bg-cyan-600",
  },
  task: {
    icon: (size) => <GitBranch size={size} {...ICON_PROPS} />,
    color: "bg-pink-600",
  },
  todowrite: {
    icon: (size) => <ListTodo size={size} {...ICON_PROPS} />,
    color: "bg-green-600",
  },
  ork: {
    icon: (size) => <Command size={size} {...ICON_PROPS} />,
    color: "bg-amber-600",
  },
  structuredoutput: {
    icon: (size) => <Send size={size} {...ICON_PROPS} />,
    color: "bg-indigo-600",
  },
  websearch: {
    icon: (size) => <Search size={size} {...ICON_PROPS} />,
    color: "bg-violet-600",
  },
  webfetch: {
    icon: (size) => <Globe size={size} {...ICON_PROPS} />,
    color: "bg-violet-600",
  },
};

const DEFAULT_TOOL_STYLE: ToolStyle = {
  icon: (size) => <HelpCircle size={size} {...ICON_PROPS} />,
  color: "bg-gray-600",
};

/**
 * Get icon for tool type.
 */
export function getToolIcon(tool: string, size: number): ReactNode {
  const style = TOOL_STYLES[tool.toLowerCase()] ?? DEFAULT_TOOL_STYLE;
  return style.icon(size);
}

/**
 * Get color class for tool type.
 */
export function getToolColor(tool: string): string {
  const style = TOOL_STYLES[tool.toLowerCase()] ?? DEFAULT_TOOL_STYLE;
  return style.color;
}

/**
 * Structured output style configuration.
 */
interface StructuredOutputStyle {
  icon: ReactNode;
  color: string;
  textColor: string;
  label: string;
}

const STRUCTURED_OUTPUT_ICON_SIZE = 14;

/**
 * Get icon and styling for structured output based on output type.
 */
export function getStructuredOutputStyle(outputType: string): StructuredOutputStyle {
  switch (outputType.toLowerCase()) {
    // Artifacts - indigo theme
    case "plan":
      return {
        icon: <FileOutput size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-indigo-600",
        textColor: "text-indigo-300",
        label: "Generating plan",
      };
    case "summary":
      return {
        icon: <FileOutput size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-indigo-600",
        textColor: "text-indigo-300",
        label: "Generating summary",
      };
    case "verdict":
      return {
        icon: <FileOutput size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-indigo-600",
        textColor: "text-indigo-300",
        label: "Generating verdict",
      };

    // Questions - yellow/amber theme
    case "questions":
      return {
        icon: <MessageCircle size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-amber-600",
        textColor: "text-amber-300",
        label: "Asking questions",
      };

    // Subtasks/breakdown - teal theme
    case "subtasks":
    case "breakdown":
      return {
        icon: <Network size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-teal-600",
        textColor: "text-teal-300",
        label: "Presenting task breakdown",
      };

    // Terminal states - red/orange theme
    case "failed":
      return {
        icon: <XCircle size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-red-600",
        textColor: "text-red-300",
        label: "Task failed",
      };
    case "blocked":
      return {
        icon: <AlertCircle size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-amber-600",
        textColor: "text-amber-300",
        label: "Task blocked",
      };

    // Control flow - blue theme
    case "approval":
      return {
        icon: <RotateCcw size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-blue-600",
        textColor: "text-blue-300",
        label: "Submitting review decision",
      };

    // Unknown/generic - indigo theme
    default:
      return {
        icon: <Send size={STRUCTURED_OUTPUT_ICON_SIZE} {...ICON_PROPS} />,
        color: "bg-indigo-600",
        textColor: "text-indigo-300",
        label: `Generating ${outputType}`,
      };
  }
}
