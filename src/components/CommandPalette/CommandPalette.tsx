/**
 * Command palette modal — triggered by Cmd+K (Ctrl+K on non-macOS).
 *
 * Spotlight-style overlay with search input and results list.
 * Searches tasks and subtasks by title, description, and ID.
 * Navigating to a result updates DisplayContext.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDisplayContext, useTasks } from "../../providers";
import { CommandPaletteResult } from "./CommandPaletteResult";
import type { SearchResult } from "./useTaskSearch";
import { useTaskSearch } from "./useTaskSearch";

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { tasks } = useTasks();
  const { focusTask, focusSubtask } = useDisplayContext();
  const results = useTaskSearch(tasks, query);

  // Reset state when opening/closing
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
      // Delay to allow animation to start
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
  const onInputKeyDown = (e: React.KeyboardEvent) => {
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
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            onClick={close}
          />

          {/* Palette */}
          <motion.div
            className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-full max-w-lg"
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            <div className="bg-white dark:bg-stone-900 rounded-panel shadow-panel-hover overflow-hidden border border-stone-200 dark:border-stone-700">
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 dark:border-stone-700">
                <Search className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => updateQuery(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search tasks..."
                  className="flex-1 bg-transparent text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500 outline-none"
                />
                <kbd className="flex-shrink-0 text-xs text-stone-400 dark:text-stone-500 bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">
                  esc
                </kbd>
              </div>

              {/* Results */}
              <div className="max-h-80 overflow-y-auto">
                {results.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-stone-400 dark:text-stone-500">
                    {query.trim() ? "No results found" : "No tasks yet"}
                  </div>
                ) : (
                  <>
                    {!query.trim() && (
                      <div className="px-3 pt-2 pb-1">
                        <span className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wider">
                          Recent
                        </span>
                      </div>
                    )}
                    <div ref={listRef}>
                      {results.map((result, index) => (
                        <CommandPaletteResult
                          key={result.task.id}
                          result={result}
                          isActive={index === activeIndex}
                          onClick={() => selectResult(result)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Footer hint */}
              {results.length > 0 && (
                <div className="px-4 py-2 border-t border-stone-200 dark:border-stone-700 flex items-center gap-3">
                  <span className="text-xs text-stone-400 dark:text-stone-500">
                    <kbd className="bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-xs mr-1">
                      &uarr;&darr;
                    </kbd>
                    navigate
                  </span>
                  <span className="text-xs text-stone-400 dark:text-stone-500">
                    <kbd className="bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-xs mr-1">
                      &crarr;
                    </kbd>
                    open
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
