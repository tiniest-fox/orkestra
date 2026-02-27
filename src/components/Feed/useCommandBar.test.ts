//! Unit tests for useCommandBar hook and taskMatchesFilter utility.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowTaskView } from "../../types/workflow";
import { taskMatchesFilter, useCommandBar } from "./useCommandBar";

// ============================================================================
// Fixtures
// ============================================================================

function makeTask(id: string, title: string): WorkflowTaskView {
  return {
    id,
    title,
    derived: {
      current_stage: null,
      is_working: false,
      is_system_active: false,
      is_preparing: false,
      phase_icon: null,
      is_interrupted: false,
      is_failed: false,
      is_blocked: false,
      is_done: false,
      is_archived: false,
      is_terminal: false,
      is_waiting_on_children: false,
      needs_review: false,
      has_questions: false,
      pending_questions: [],
      rejection_feedback: null,
      pending_rejection: null,
      stages_with_logs: [],
      subtask_progress: null,
    },
    iterations: [],
    stage_sessions: [],
  } as unknown as WorkflowTaskView;
}

const NO_TASKS: WorkflowTaskView[] = [];

function makeHook(filterText: string, tasks: WorkflowTaskView[] = NO_TASKS) {
  const onExecuteCommand = vi.fn();
  const onSelectTask = vi.fn();
  const { result, rerender } = renderHook(
    ({ filter, ts }: { filter: string; ts: WorkflowTaskView[] }) =>
      useCommandBar({ tasks: ts, filterText: filter, onExecuteCommand, onSelectTask }),
    { initialProps: { filter: filterText, ts: tasks } },
  );
  return { result, rerender, onExecuteCommand, onSelectTask };
}

// ============================================================================
// taskMatchesFilter
// ============================================================================

describe("taskMatchesFilter", () => {
  it("returns true for case-insensitive substring match", () => {
    expect(taskMatchesFilter("Fix the Bug", "bug")).toBe(true);
    expect(taskMatchesFilter("Fix the Bug", "BUG")).toBe(true);
    expect(taskMatchesFilter("Fix the Bug", "Fix")).toBe(true);
  });

  it("returns false when title does not contain filter", () => {
    expect(taskMatchesFilter("Fix the Bug", "push")).toBe(false);
  });

  it("returns true for full title match", () => {
    expect(taskMatchesFilter("Refactor auth", "Refactor auth")).toBe(true);
  });

  it("returns true for any title when filter is empty string", () => {
    expect(taskMatchesFilter("Anything", "")).toBe(true);
    expect(taskMatchesFilter("", "")).toBe(true);
  });
});

// ============================================================================
// Command matching
// ============================================================================

describe("command matching", () => {
  it("returns both Pull and Push for filterText 'pu'", () => {
    const { result } = makeHook("pu");
    const ids = result.current.items.map((i) => i.id);
    expect(ids).toContain("pull");
    expect(ids).toContain("push");
  });

  it("returns only commands that start with the filter", () => {
    const { result } = makeHook("fe");
    const ids = result.current.items.map((i) => i.id);
    expect(ids).toContain("fetch");
    expect(ids).not.toContain("pull");
    expect(ids).not.toContain("push");
  });

  it("returns assistant command for filterText 'as'", () => {
    const { result } = makeHook("as");
    const ids = result.current.items.map((i) => i.id);
    expect(ids).toContain("assistant");
  });

  it("returns only commands as type 'command' even when tasks are present", () => {
    const tasks = [makeTask("t1", "Push notification service")];
    const { result } = makeHook("pu", tasks);
    const commands = result.current.items.filter((i) => i.type === "command");
    const taskItems = result.current.items.filter((i) => i.type === "task");
    expect(commands.length).toBeGreaterThan(0);
    expect(taskItems.length).toBeGreaterThan(0);
    commands.forEach((item) => {
      expect(item.type).toBe("command");
    });
    taskItems.forEach((item) => {
      expect(item.type).toBe("task");
    });
  });
});

// ============================================================================
// Task matching
// ============================================================================

describe("task matching", () => {
  it("returns tasks whose titles match the filter", () => {
    const tasks = [
      makeTask("t1", "Add login feature"),
      makeTask("t2", "Fix logout bug"),
      makeTask("t3", "Update styles"),
    ];
    const { result } = makeHook("log", tasks);
    const ids = result.current.items.map((i) => i.id);
    expect(ids).toContain("t1");
    expect(ids).toContain("t2");
    expect(ids).not.toContain("t3");
  });

  it("returns tasks as type 'task'", () => {
    const tasks = [makeTask("t1", "Add login feature")];
    const { result } = makeHook("login", tasks);
    const taskItems = result.current.items.filter((i) => i.type === "task");
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0].id).toBe("t1");
  });
});

// ============================================================================
// Empty filter
// ============================================================================

describe("empty filter", () => {
  it("returns no items when filterText is empty", () => {
    const { result } = makeHook("");
    expect(result.current.items).toHaveLength(0);
    expect(result.current.showDropdown).toBe(false);
  });
});

// ============================================================================
// showDropdown boundary cases
// ============================================================================

describe("showDropdown", () => {
  it("is false when filter text matches no commands and no tasks", () => {
    const tasks = [makeTask("t1", "Add login feature")];
    const { result } = makeHook("zzz", tasks);
    expect(result.current.items).toHaveLength(0);
    expect(result.current.showDropdown).toBe(false);
  });
});

// ============================================================================
// onInputKeyDown with showDropdown false
// ============================================================================

describe("onInputKeyDown is a no-op when showDropdown is false", () => {
  it("does not call onExecuteCommand when dropdown is closed", () => {
    const { result, onExecuteCommand } = makeHook("zzz");
    // Dropdown is closed — no matches
    expect(result.current.showDropdown).toBe(false);

    act(() => {
      result.current.onInputKeyDown({ key: "Enter", preventDefault: vi.fn() } as never);
    });

    expect(onExecuteCommand).not.toHaveBeenCalled();
  });

  it("does not change highlightedIndex on ArrowDown when dropdown is closed", () => {
    const { result } = makeHook("zzz");
    expect(result.current.showDropdown).toBe(false);
    const before = result.current.highlightedIndex;

    act(() => {
      result.current.onInputKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
    });

    expect(result.current.highlightedIndex).toBe(before);
  });
});

// ============================================================================
// Keyboard navigation
// ============================================================================

describe("keyboard navigation", () => {
  it("ArrowDown from last item wraps to index 0", () => {
    const { result } = makeHook("pu"); // pull + push = 2 items
    expect(result.current.items).toHaveLength(2);

    // Navigate to the last item
    act(() => {
      result.current.onInputKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
    });
    expect(result.current.highlightedIndex).toBe(1);

    // ArrowDown from last wraps to 0
    act(() => {
      result.current.onInputKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
    });
    expect(result.current.highlightedIndex).toBe(0);
  });

  it("ArrowUp from index 0 wraps to last item", () => {
    const { result } = makeHook("pu"); // pull + push = 2 items
    expect(result.current.items).toHaveLength(2);
    expect(result.current.highlightedIndex).toBe(0);

    // ArrowUp from 0 wraps to last
    act(() => {
      result.current.onInputKeyDown({ key: "ArrowUp", preventDefault: vi.fn() } as never);
    });
    expect(result.current.highlightedIndex).toBe(1);
  });
});

// ============================================================================
// Enter executes highlighted item
// ============================================================================

describe("Enter key executes highlighted item", () => {
  it("calls onExecuteCommand for a command item", () => {
    const { result, onExecuteCommand } = makeHook("pull");
    // "pull" matches exactly one command item at index 0
    expect(result.current.items[0]?.id).toBe("pull");

    act(() => {
      result.current.onInputKeyDown({ key: "Enter", preventDefault: vi.fn() } as never);
    });
    expect(onExecuteCommand).toHaveBeenCalledWith("pull");
  });

  it("calls onSelectTask for a task item", () => {
    const tasks = [makeTask("task-42", "Fix login bug")];
    const { result, onSelectTask } = makeHook("login", tasks);
    // The task item should be in the list (commands start with "login" → none match, so index 0 is the task)
    const taskItem = result.current.items.find((i) => i.type === "task");
    expect(taskItem?.id).toBe("task-42");

    // Navigate to the task item
    const taskIndex = result.current.items.findIndex((i) => i.type === "task");
    act(() => {
      result.current.setHighlightedIndex(taskIndex);
    });

    act(() => {
      result.current.onInputKeyDown({ key: "Enter", preventDefault: vi.fn() } as never);
    });
    expect(onSelectTask).toHaveBeenCalledWith("task-42");
  });
});

// ============================================================================
// executeItem
// ============================================================================

describe("executeItem", () => {
  it("calls onExecuteCommand when item type is command", () => {
    const { result, onExecuteCommand } = makeHook("new");
    const commandItem = result.current.items.find((i) => i.type === "command");
    expect(commandItem).toBeDefined();
    if (!commandItem) return;
    act(() => {
      result.current.executeItem(commandItem);
    });
    expect(onExecuteCommand).toHaveBeenCalledWith("new");
  });

  it("calls onSelectTask when item type is task", () => {
    const tasks = [makeTask("t99", "Deploy to prod")];
    const { result, onSelectTask } = makeHook("deploy", tasks);
    const taskItem = result.current.items.find((i) => i.type === "task");
    expect(taskItem).toBeDefined();
    if (!taskItem) return;
    act(() => {
      result.current.executeItem(taskItem);
    });
    expect(onSelectTask).toHaveBeenCalledWith("t99");
  });
});

// ============================================================================
// Index resets on item change
// ============================================================================

describe("index resets on item change", () => {
  it("resets highlightedIndex to 0 when filterText changes and items change", () => {
    const { result, rerender } = makeHook("pu");
    // Navigate to index 1
    act(() => {
      result.current.onInputKeyDown({ key: "ArrowDown", preventDefault: vi.fn() } as never);
    });
    expect(result.current.highlightedIndex).toBe(1);

    // Change filter — new items array reference → index should reset
    act(() => {
      rerender({ filter: "fe", ts: NO_TASKS });
    });

    expect(result.current.highlightedIndex).toBe(0);
  });
});
