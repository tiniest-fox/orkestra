import {
  Circle,
  FileEdit,
  FilePlus,
  FileText,
  FolderSearch,
  GitBranch,
  HelpCircle,
  ListTodo,
  type LucideIcon,
  Search,
  Terminal,
} from "lucide-react";

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
};

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
