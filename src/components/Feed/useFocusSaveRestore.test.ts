//! Unit tests for useFocusSaveRestore hook.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFocusSaveRestore } from "./useFocusSaveRestore";

// ============================================================================
// Fixtures
// ============================================================================

function makeHook(currentFocusedId: string | null = "row-1") {
  const onRestoreFocus = vi.fn();
  const { result, rerender } = renderHook(
    ({ focusedId }: { focusedId: string | null }) =>
      useFocusSaveRestore({ currentFocusedId: focusedId, onRestoreFocus }),
    { initialProps: { focusedId: currentFocusedId } },
  );
  return { result, rerender, onRestoreFocus };
}

// ============================================================================
// Enter filter mode
// ============================================================================

describe("enter filter mode", () => {
  it("saves the current focused ID when transitioning from empty to non-empty filter", () => {
    const { result, onRestoreFocus } = makeHook("row-1");

    act(() => {
      result.current.handleFilterChange("a");
    });

    expect(result.current.filterText).toBe("a");

    act(() => {
      result.current.clearFilter();
    });

    expect(onRestoreFocus).toHaveBeenCalledWith("row-1");
  });
});

// ============================================================================
// Re-entry guard
// ============================================================================

describe("re-entry guard", () => {
  it("does not overwrite the saved ID when the user types more characters", () => {
    const { result, onRestoreFocus } = makeHook("row-1");

    // Enter filter mode — "row-1" is saved.
    act(() => {
      result.current.handleFilterChange("a");
    });

    // Type an additional character — preFocusIdRef should not be overwritten.
    act(() => {
      result.current.handleFilterChange("ab");
    });

    act(() => {
      result.current.clearFilter();
    });

    expect(onRestoreFocus).toHaveBeenCalledWith("row-1");
    expect(onRestoreFocus).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Leave filter mode
// ============================================================================

describe("leave filter mode", () => {
  it("calls onRestoreFocus with saved ID and resets filterText when cleared via handleFilterChange", () => {
    const { result, onRestoreFocus } = makeHook("row-42");

    act(() => {
      result.current.handleFilterChange("x");
    });

    expect(result.current.filterText).toBe("x");

    act(() => {
      result.current.handleFilterChange("");
    });

    expect(result.current.filterText).toBe("");
    expect(onRestoreFocus).toHaveBeenCalledWith("row-42");
  });
});

// ============================================================================
// No restore when no saved ID
// ============================================================================

describe("no restore when no saved ID", () => {
  it("does not call onRestoreFocus when currentFocusedId was null when entering filter mode", () => {
    const { result, onRestoreFocus } = makeHook(null);

    act(() => {
      result.current.handleFilterChange("a");
    });

    act(() => {
      result.current.clearFilter();
    });

    expect(onRestoreFocus).not.toHaveBeenCalled();
  });
});

// ============================================================================
// clearFilter resets state
// ============================================================================

describe("clearFilter resets state", () => {
  it("allows saving a new focused ID after clearFilter is called", () => {
    const { result, rerender, onRestoreFocus } = makeHook("row-1");

    // First filter session.
    act(() => {
      result.current.handleFilterChange("a");
    });
    act(() => {
      result.current.clearFilter();
    });

    // Focus has moved to a new row; enter filter mode again.
    rerender({ focusedId: "row-99" });

    act(() => {
      result.current.handleFilterChange("x");
    });
    act(() => {
      result.current.clearFilter();
    });

    expect(onRestoreFocus).toHaveBeenCalledTimes(2);
    expect(onRestoreFocus).toHaveBeenNthCalledWith(1, "row-1");
    expect(onRestoreFocus).toHaveBeenNthCalledWith(2, "row-99");
  });
});
