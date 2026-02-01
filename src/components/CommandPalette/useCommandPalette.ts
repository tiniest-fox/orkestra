/**
 * Hook encapsulating all Command Palette interaction logic.
 *
 * Manages open/close state, global Cmd+K hotkey, search query,
 * keyboard navigation, result selection, and auto-focus/scroll.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDisplayContext } from "../../providers";
import type { WorkflowTaskView } from "../../types/workflow";
import type { SearchResult } from "./useTaskSearch";
import { useTaskSearch } from "./useTaskSearch";

export function useCommandPalette(tasks: WorkflowTaskView[]) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { focusTask, focusSubtask } = useDisplayContext();
  const results = useTaskSearch(tasks, query);

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
          setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (results[activeIndex]) {
            selectResult(results[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
      }
    },
    [results, activeIndex, selectResult, close],
  );

  return {
    isOpen,
    close,
    query,
    updateQuery,
    activeIndex,
    onInputKeyDown,
    selectResult,
    inputRef,
    listRef,
    results,
  };
}
