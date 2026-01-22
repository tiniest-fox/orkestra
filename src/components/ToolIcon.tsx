import {
  AlertCircle,
  CheckCircle,
  Circle,
  FileCheck,
  FileEdit,
  FilePlus,
  FileText,
  FolderSearch,
  GitBranch,
  HelpCircle,
  ListPlus,
  ListTodo,
  type LucideIcon,
  Search,
  Sparkles,
  Terminal,
  Wand2,
  XCircle,
} from "lucide-react";
import type { OrkAction } from "../types/task";

interface ToolIconProps {
  tool: string;
  size?: number;
  className?: string;
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Read: FileText,
  Write: FilePlus,
  Edit: FileEdit,
  Glob: FolderSearch,
  Grep: Search,
  Task: GitBranch,
  TodoWrite: ListTodo,
  NotebookEdit: FileEdit,
  WebFetch: Search,
  WebSearch: Search,
  Ork: Wand2,
};

/** Get the sub-icon for an Ork action */
export function getOrkSubIcon(action: OrkAction["action"]): {
  icon: LucideIcon;
  className: string;
} {
  switch (action) {
    case "complete":
    case "complete_subtask":
      return { icon: CheckCircle, className: "text-green-500" };
    case "fail":
      return { icon: XCircle, className: "text-red-500" };
    case "block":
      return { icon: AlertCircle, className: "text-orange-500" };
    case "set_plan":
    case "set_breakdown":
      return { icon: FileCheck, className: "text-blue-500" };
    case "approve":
    case "approve_review":
    case "approve_breakdown":
      return { icon: Sparkles, className: "text-green-500" };
    case "reject_review":
      return { icon: XCircle, className: "text-amber-500" };
    case "create_subtask":
      return { icon: ListPlus, className: "text-purple-500" };
    case "skip_breakdown":
      return { icon: CheckCircle, className: "text-gray-400" };
    default:
      return { icon: Wand2, className: "text-indigo-400" };
  }
}

export function ToolIcon({ tool, size = 16, className = "" }: ToolIconProps) {
  const IconComponent = TOOL_ICONS[tool];

  if (IconComponent) {
    return <IconComponent size={size} className={className} />;
  }

  // Check if tool name contains known patterns (case-insensitive fallbacks)
  const toolLower = tool.toLowerCase();
  if (toolLower.includes("bash") || toolLower.includes("terminal")) {
    return <Terminal size={size} className={className} />;
  }
  if (toolLower.includes("read") || toolLower.includes("file")) {
    return <FileText size={size} className={className} />;
  }
  if (toolLower.includes("write")) {
    return <FilePlus size={size} className={className} />;
  }
  if (toolLower.includes("edit")) {
    return <FileEdit size={size} className={className} />;
  }
  if (toolLower.includes("search") || toolLower.includes("grep")) {
    return <Search size={size} className={className} />;
  }
  if (toolLower.includes("glob") || toolLower.includes("folder")) {
    return <FolderSearch size={size} className={className} />;
  }
  if (toolLower.includes("task") || toolLower.includes("agent")) {
    return <GitBranch size={size} className={className} />;
  }
  if (toolLower.includes("todo")) {
    return <ListTodo size={size} className={className} />;
  }

  // Default fallback for unknown tools
  if (tool === "unknown" || tool === "") {
    return <Circle size={size} className={className} />;
  }

  return <HelpCircle size={size} className={className} />;
}
