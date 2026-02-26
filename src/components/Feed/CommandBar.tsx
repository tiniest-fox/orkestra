//! Command bar with accent prompt, monospace input, and autocomplete dropdown.

import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import type { WorkflowTaskView } from "../../types/workflow";
import type { CommandBarItem } from "./useCommandBar";
import { useCommandBar } from "./useCommandBar";

// ============================================================================
// DropdownSection
// ============================================================================

interface DropdownSectionProps {
  label: string;
  items: Array<{ item: CommandBarItem; globalIndex: number }>;
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (item: CommandBarItem) => void;
}

function DropdownSection({
  label,
  items,
  highlightedIndex,
  onHighlight,
  onSelect,
}: DropdownSectionProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="px-4 py-1.5 font-mono text-[10px] font-semibold tracking-[0.10em] uppercase text-text-quaternary">
        {label}
      </div>
      {items.map(({ item, globalIndex }) => {
        const isHighlighted = globalIndex === highlightedIndex;
        return (
          <div
            key={item.id}
            id={`command-bar-option-${globalIndex}`}
            role="option"
            aria-selected={isHighlighted}
            tabIndex={-1}
            className={`px-4 py-2 cursor-default font-mono text-[12px] ${
              isHighlighted ? "bg-accent-soft text-text-primary" : "text-text-secondary"
            }`}
            onMouseEnter={() => onHighlight(globalIndex)}
            onClick={() => onSelect(item)}
            onKeyDown={() => {}}
          >
            <span>{item.label}</span>
            {item.description && (
              <span className="text-text-quaternary ml-2">{item.description}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// CommandBar
// ============================================================================

interface CommandBarProps {
  tasks: WorkflowTaskView[];
  filterText: string;
  onFilterChange: (text: string) => void;
  onExecuteCommand: (command: string) => void;
  onSelectTask: (taskId: string) => void;
  inputRef: RefObject<HTMLInputElement>;
}

export function CommandBar({
  tasks,
  filterText,
  onFilterChange,
  onExecuteCommand,
  onSelectTask,
  inputRef,
}: CommandBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    items,
    highlightedIndex,
    setHighlightedIndex,
    showDropdown,
    onInputKeyDown,
    executeItem,
  } = useCommandBar({ tasks, filterText, onExecuteCommand, onSelectTask });

  useEffect(() => {
    if (!showDropdown) return;
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        onFilterChange("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showDropdown, onFilterChange]);

  const indexed = items.map((item, index) => ({ item, globalIndex: index }));
  const commandItems = indexed.filter(({ item }) => item.type === "command");
  const taskItems = indexed.filter(({ item }) => item.type === "task");

  return (
    <div
      ref={containerRef}
      className="relative flex items-center h-9 px-6 bg-surface border-b border-border shrink-0"
    >
      <span className="text-accent font-semibold font-mono text-[12px] mr-2 select-none">&gt;</span>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="command-bar-listbox"
        aria-activedescendant={showDropdown ? `command-bar-option-${highlightedIndex}` : undefined}
        aria-autocomplete="list"
        value={filterText}
        onChange={(e) => onFilterChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Filter tasks or type a command..."
        className="flex-1 bg-transparent outline-none font-mono text-[12px] text-text-primary placeholder:text-text-quaternary"
      />

      {showDropdown && (
        <div
          id="command-bar-listbox"
          role="listbox"
          className="absolute top-full left-0 right-0 z-20 bg-surface border border-border rounded-panel-sm shadow-panel mt-0.5 max-h-[280px] overflow-y-auto"
        >
          <DropdownSection
            label="Commands"
            items={commandItems}
            highlightedIndex={highlightedIndex}
            onHighlight={setHighlightedIndex}
            onSelect={executeItem}
          />
          <DropdownSection
            label="Tasks"
            items={taskItems}
            highlightedIndex={highlightedIndex}
            onHighlight={setHighlightedIndex}
            onSelect={executeItem}
          />
        </div>
      )}
    </div>
  );
}
