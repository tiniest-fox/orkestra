/**
 * Tests for useAutoCollapsePaths hook.
 *
 * Verifies the userHasInteracted guard: auto-collapse runs on first load,
 * skips when the user has interacted, and re-runs after resetInteraction.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { useAutoCollapsePaths } from "./useAutoCollapsePaths";

// ============================================================================
// Test data builders
// ============================================================================

function makeFile(
  path: string,
  opts: {
    changeType?: "added" | "modified" | "deleted" | "renamed";
    additions?: number;
    deletions?: number;
  } = {},
): HighlightedFileDiff {
  return {
    path,
    change_type: opts.changeType ?? "modified",
    old_path: null,
    additions: opts.additions ?? 0,
    deletions: opts.deletions ?? 0,
    is_binary: false,
    hunks: [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("useAutoCollapsePaths", () => {
  it("computes initial collapsed set from shouldAutoCollapse on first render", () => {
    const files = [
      makeFile("small.ts", { additions: 5 }),
      makeFile("large.ts", { additions: 200, deletions: 150 }), // >= 300 total → auto-collapse
      makeFile("deleted.ts", { changeType: "deleted" }),
    ];

    const { result } = renderHook(() => useAutoCollapsePaths(files));

    expect(result.current.collapsedPaths.has("small.ts")).toBe(false);
    expect(result.current.collapsedPaths.has("large.ts")).toBe(true);
    expect(result.current.collapsedPaths.has("deleted.ts")).toBe(true);
  });

  it("toggleCollapsed updates the set and marks user as having interacted", () => {
    const files = [makeFile("foo.ts")];
    const { result } = renderHook(() => useAutoCollapsePaths(files));

    expect(result.current.collapsedPaths.has("foo.ts")).toBe(false);

    act(() => {
      result.current.toggleCollapsed("foo.ts");
    });

    expect(result.current.collapsedPaths.has("foo.ts")).toBe(true);
  });

  it("after user interaction, changing files does NOT re-compute auto-collapse", () => {
    const initialFiles = [makeFile("foo.ts")];
    const { result, rerender } = renderHook(({ files }) => useAutoCollapsePaths(files), {
      initialProps: { files: initialFiles },
    });

    // Interact: collapse foo.ts manually
    act(() => {
      result.current.toggleCollapsed("foo.ts");
    });
    expect(result.current.collapsedPaths.has("foo.ts")).toBe(true);

    // New files with a deleted file that would normally be auto-collapsed
    const newFiles = [makeFile("foo.ts"), makeFile("deleted.ts", { changeType: "deleted" })];

    rerender({ files: newFiles });

    // User interacted, so auto-collapse should NOT run again
    // foo.ts should remain collapsed (user set it), deleted.ts should NOT be auto-collapsed
    expect(result.current.collapsedPaths.has("foo.ts")).toBe(true);
    expect(result.current.collapsedPaths.has("deleted.ts")).toBe(false);
  });

  it("resetInteraction allows auto-collapse to re-run on next file change", () => {
    const initialFiles = [makeFile("foo.ts")];
    const { result, rerender } = renderHook(({ files }) => useAutoCollapsePaths(files), {
      initialProps: { files: initialFiles },
    });

    // Interact
    act(() => {
      result.current.toggleCollapsed("foo.ts");
    });

    // Reset interaction flag
    act(() => {
      result.current.resetInteraction();
    });

    // After reset, collapsedPaths is unchanged — reset clears the interaction flag only, not the set
    expect(result.current.collapsedPaths.has("foo.ts")).toBe(true);

    // Now provide new files with an auto-collapsible file
    const newFiles = [makeFile("deleted.ts", { changeType: "deleted" })];
    rerender({ files: newFiles });

    // Auto-collapse should now run
    expect(result.current.collapsedPaths.has("deleted.ts")).toBe(true);
  });

  it("passing undefined files resets to empty set and clears interaction flag", () => {
    const initialFiles = [makeFile("deleted.ts", { changeType: "deleted" })];
    const { result, rerender } = renderHook(
      ({ files }: { files: typeof initialFiles | undefined }) => useAutoCollapsePaths(files),
      { initialProps: { files: initialFiles as typeof initialFiles | undefined } },
    );

    // Auto-collapse ran
    expect(result.current.collapsedPaths.has("deleted.ts")).toBe(true);

    // Interact so flag is set
    act(() => {
      result.current.toggleCollapsed("deleted.ts");
    });

    // Pass undefined — resets everything
    rerender({ files: undefined });

    expect(result.current.collapsedPaths.size).toBe(0);

    // Now provide files again — auto-collapse should run (flag was cleared)
    rerender({ files: [makeFile("deleted.ts", { changeType: "deleted" })] });

    expect(result.current.collapsedPaths.has("deleted.ts")).toBe(true);
  });
});
