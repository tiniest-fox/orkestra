/**
 * Client-side search over tasks and subtasks.
 *
 * Uses case-insensitive String.includes() on title, description, and ID.
 * Results are grouped (tasks before subtasks), with exact ID matches
 * floated to the top, then sorted by updated_at descending.
 * Capped at 20 results.
 */

import { useMemo } from "react";
import type { WorkflowTaskView } from "../../types/workflow";

const MAX_RESULTS = 20;

export interface SearchResult {
  task: WorkflowTaskView;
  /** If this result is a subtask, the parent task. */
  parent: WorkflowTaskView | null;
  /** Whether the match was on the task ID (exact match). */
  isIdMatch: boolean;
}

function matchesQuery(task: WorkflowTaskView, query: string): boolean {
  const q = query.toLowerCase();
  return (
    task.id.toLowerCase().includes(q) ||
    task.title.toLowerCase().includes(q) ||
    task.description.toLowerCase().includes(q)
  );
}

function isExactIdMatch(task: WorkflowTaskView, query: string): boolean {
  return task.id.toLowerCase() === query.toLowerCase();
}

export function useTaskSearch(tasks: WorkflowTaskView[], query: string): SearchResult[] {
  return useMemo(() => {
    const trimmed = query.trim();

    // Empty query: show recently updated tasks (top-level only)
    if (!trimmed) {
      return tasks
        .filter((t) => !t.parent_id)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, MAX_RESULTS)
        .map((task) => ({ task, parent: null, isIdMatch: false }));
    }

    // Build a parent lookup for subtask results
    const taskById = new Map<string, WorkflowTaskView>();
    for (const t of tasks) {
      taskById.set(t.id, t);
    }

    const topLevelMatches: SearchResult[] = [];
    const subtaskMatches: SearchResult[] = [];

    for (const task of tasks) {
      if (!matchesQuery(task, trimmed)) continue;

      const idMatch = isExactIdMatch(task, trimmed);
      if (task.parent_id) {
        subtaskMatches.push({
          task,
          parent: taskById.get(task.parent_id) ?? null,
          isIdMatch: idMatch,
        });
      } else {
        topLevelMatches.push({
          task,
          parent: null,
          isIdMatch: idMatch,
        });
      }
    }

    // Sort: exact ID matches first, then by updated_at descending
    const sortResults = (results: SearchResult[]) =>
      results.sort((a, b) => {
        if (a.isIdMatch !== b.isIdMatch) return a.isIdMatch ? -1 : 1;
        return b.task.updated_at.localeCompare(a.task.updated_at);
      });

    sortResults(topLevelMatches);
    sortResults(subtaskMatches);

    return [...topLevelMatches, ...subtaskMatches].slice(0, MAX_RESULTS);
  }, [tasks, query]);
}
