/**
 * Tests for shouldAutoCollapse predicate.
 */

import { describe, expect, it } from "vitest";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { shouldAutoCollapse } from "./shouldAutoCollapse";

function makeFile(overrides: Partial<HighlightedFileDiff> = {}): HighlightedFileDiff {
  return {
    path: "src/foo.ts",
    change_type: "modified",
    old_path: null,
    additions: 0,
    deletions: 0,
    is_binary: false,
    hunks: [],
    ...overrides,
  };
}

describe("shouldAutoCollapse", () => {
  it("returns true for deleted files", () => {
    expect(shouldAutoCollapse(makeFile({ change_type: "deleted" }))).toBe(true);
  });

  it("returns true when additions + deletions >= 300", () => {
    expect(shouldAutoCollapse(makeFile({ additions: 200, deletions: 100 }))).toBe(true);
    expect(shouldAutoCollapse(makeFile({ additions: 300, deletions: 0 }))).toBe(true);
    expect(shouldAutoCollapse(makeFile({ additions: 0, deletions: 300 }))).toBe(true);
  });

  it("returns false when additions + deletions < 300", () => {
    expect(shouldAutoCollapse(makeFile({ additions: 150, deletions: 149 }))).toBe(false);
    expect(shouldAutoCollapse(makeFile({ additions: 0, deletions: 0 }))).toBe(false);
  });

  it("returns false for added files with few changes", () => {
    expect(
      shouldAutoCollapse(makeFile({ change_type: "added", additions: 10, deletions: 0 })),
    ).toBe(false);
  });

  it("returns false for binary files", () => {
    expect(shouldAutoCollapse(makeFile({ is_binary: true, change_type: "modified" }))).toBe(false);
  });
});
