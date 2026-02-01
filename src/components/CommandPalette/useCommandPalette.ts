/**
 * Hook encapsulating all Command Palette interaction logic.
 *
 * Manages open/close state, global Cmd+K hotkey, search query,
 * keyboard navigation, result selection, and auto-focus/scroll.
 *
 * The palette shows two kinds of items:
 * - Actions: commands like "New Task" matched by keywords
 * - Search results: tasks/subtasks matched by title, description, ID
 *
 * Actions appear above search results. Keyboard navigation spans both.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDisplayContext } from "../../providers";
import type { WorkflowTaskView } from "../../types/workflow";
import type { PaletteAction } from "./useActionSearch";
import { useActionSearch } from "./useActionSearch";
import type { SearchResult } from "./useTaskSearch";
import { useTaskSearch } from "./useTaskSearch";

/** A single selectable item in the palette — either an action or a search result. */
export type PaletteItem =
  | { type: "action"; action: PaletteAction }
  | { type: "result"; result: SearchResult };

export function useCommandPalette(tasks: WorkflowTaskView[]) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { focusTask, focusSubtask, openCreate } = useDisplayContext();
  const actions = useActionSearch(query);
  const results = useTaskSearch(tasks, query);

  // Combined list: actions first, then search results
  const items: PaletteItem[] = useMemo(
    () => [
      ...actions.map((action): PaletteItem => ({ type: "action", action })),
      ...results.map((result): PaletteItem => ({ type: "result", result })),
    ],
    [actions, results],
  );

  const open = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Execute an action command
  const executeAction = useCallback(
    (action: PaletteAction) => {
      switch (action.id) {
        case "create-task":
          openCreate();
          break;
      }
      close();
    },
    [openCreate, close],
  );

  // Navigate to a search result
  const selectResult = useCallback(
    (result: SearchResult) => {
      if (result.task.parent_id && result.parent) {
        focusSubtask(result.parent.id, result.task.id);
      } else {
        focusTask(result.task.id);
      }
      close();
    },
    [focusTask, focusSubtask, close],
  );

  // Select any palette item (action or result)
  const selectItem = useCallback(
    (item: PaletteItem) => {
      if (item.type === "action") {
        executeAction(item.action);
      } else {
        selectResult(item.result);
      }
    },
    [executeAction, selectResult],
  );

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Reset active index whenever the query changes
  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(0);
  }, []);

  // Scroll active result into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Keyboard navigation within the palette
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (items[activeIndex]) {
            selectItem(items[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
      }
    },
    [items, activeIndex, selectItem, close],
  );

  return {
    isOpen,
    close,
    query,
    updateQuery,
    activeIndex,
    onInputKeyDown,
    selectItem,
    inputRef,
    listRef,
    items,
  };
}
