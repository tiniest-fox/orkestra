//! Hook managing autocomplete state, command definitions, and keyboard navigation for CommandBar.

import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { WorkflowTaskView } from "../../types/workflow";

export interface CommandBarItem {
  type: "command" | "task";
  id: string;
  label: string;
  description?: string;
}

interface UseCommandBarArgs {
  tasks: WorkflowTaskView[];
  filterText: string;
  onExecuteCommand: (command: string) => void;
  onSelectTask: (taskId: string) => void;
}

interface UseCommandBarReturn {
  items: CommandBarItem[];
  highlightedIndex: number;
  setHighlightedIndex: (index: number) => void;
  showDropdown: boolean;
  onInputKeyDown: (e: KeyboardEvent) => void;
  executeItem: (item: CommandBarItem) => void;
}

const COMMANDS = [
  { name: "new", label: "New Trak", description: "Create a new Trak" },
  { name: "assistant", label: "Assistant", description: "Open project assistant" },
  { name: "fetch", label: "Fetch", description: "Fetch from origin" },
  { name: "pull", label: "Pull", description: "Pull from origin" },
  { name: "push", label: "Push", description: "Push to origin" },
  { name: "history", label: "History", description: "Toggle git history" },
];

/** Returns true when the task title contains the filter text (case-insensitive). */
export function taskMatchesFilter(title: string, filter: string): boolean {
  return title.toLowerCase().includes(filter.toLowerCase());
}

/** Manages autocomplete items, highlighted index, and keyboard navigation for the command bar. */
export function useCommandBar({
  tasks,
  filterText,
  onExecuteCommand,
  onSelectTask,
}: UseCommandBarArgs): UseCommandBarReturn {
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const items = useMemo<CommandBarItem[]>(() => {
    if (!filterText) return [];

    const lower = filterText.toLowerCase();

    const matchingCommands: CommandBarItem[] = COMMANDS.filter((c) => c.name.startsWith(lower)).map(
      (c) => ({
        type: "command",
        id: c.name,
        label: c.label,
        description: c.description,
      }),
    );

    const matchingTasks: CommandBarItem[] = tasks
      .filter((t) => taskMatchesFilter(t.title, filterText))
      .map((t) => ({
        type: "task",
        id: t.id,
        label: t.title,
        description: t.derived.current_stage ?? undefined,
      }));

    return [...matchingCommands, ...matchingTasks];
  }, [tasks, filterText]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items is used as a trigger — we reset the index whenever the filtered list changes, not to read its value
  useEffect(() => {
    setHighlightedIndex(0);
  }, [items]);

  const showDropdown = filterText.length > 0 && items.length > 0;

  function executeItem(item: CommandBarItem) {
    if (item.type === "command") {
      onExecuteCommand(item.id);
    } else {
      onSelectTask(item.id);
    }
  }

  function onInputKeyDown(e: KeyboardEvent) {
    if (!showDropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < items.length) {
        e.preventDefault();
        executeItem(items[highlightedIndex]);
      }
    }
  }

  return {
    items,
    highlightedIndex,
    setHighlightedIndex,
    showDropdown,
    onInputKeyDown,
    executeItem,
  };
}
