/**
 * Command palette modal — triggered by Cmd+K (Ctrl+K on non-macOS).
 *
 * Spotlight-style overlay with search input and results list.
 * Shows two kinds of items:
 * - Actions: commands like "New Task" matched by keywords
 * - Search results: tasks and subtasks by title, description, and ID
 *
 * Thin rendering layer: composes ModalPanel for overlay infrastructure
 * and useCommandPalette for all state and interaction logic.
 */

import { Search } from "lucide-react";
import { useTasks } from "../../providers";
import { ModalPanel } from "../ui/ModalPanel";
import { CommandPaletteAction, CommandPaletteResult } from "./CommandPaletteResult";
import { useCommandPalette } from "./useCommandPalette";

export function CommandPalette() {
  const { tasks } = useTasks();
  const {
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
  } = useCommandPalette(tasks);

  const hasQuery = query.trim().length > 0;

  return (
    <ModalPanel
      isOpen={isOpen}
      onClose={close}
      className="inset-x-0 top-[20%] flex justify-center px-4"
    >
      <div className="w-full max-w-lg bg-white dark:bg-stone-900 rounded-panel shadow-panel-hover overflow-hidden border border-stone-200 dark:border-stone-700">
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
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-stone-400 dark:text-stone-500">
              {hasQuery ? "No results found" : "No tasks yet"}
            </div>
          ) : (
            <>
              {!hasQuery && (
                <div className="px-3 pt-2 pb-1">
                  <span className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wider">
                    Recent
                  </span>
                </div>
              )}
              <div ref={listRef}>
                {items.map((item, index) =>
                  item.type === "action" ? (
                    <CommandPaletteAction
                      key={item.action.id}
                      action={item.action}
                      isActive={index === activeIndex}
                      onClick={() => selectItem(item)}
                    />
                  ) : (
                    <CommandPaletteResult
                      key={item.result.task.id}
                      result={item.result}
                      isActive={index === activeIndex}
                      onClick={() => selectItem(item)}
                    />
                  ),
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer hint */}
        {items.length > 0 && (
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
    </ModalPanel>
  );
}
