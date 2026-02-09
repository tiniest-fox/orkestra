/**
 * Matches typed queries against a static list of command palette actions.
 *
 * Actions are commands (like "New Task") that appear when the user types
 * matching keywords. Each action has a set of keywords that trigger it.
 */

import { useMemo } from "react";

export interface PaletteAction {
  id: string;
  label: string;
  /** Keywords that trigger this action (matched case-insensitively). */
  keywords: string[];
}

const ACTIONS: PaletteAction[] = [
  {
    id: "create-task",
    label: "New Task",
    keywords: ["new", "create", "add", "task"],
  },
  {
    id: "open-assistant",
    label: "Open Assistant",
    keywords: ["assistant", "chat", "ai"],
  },
];

export function useActionSearch(query: string): PaletteAction[] {
  return useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    return ACTIONS.filter((action) =>
      action.keywords.some((keyword) => keyword.startsWith(trimmed) || trimmed.includes(keyword)),
    );
  }, [query]);
}
