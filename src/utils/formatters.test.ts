import { describe, expect, it } from "vitest";
import { formatPath } from "./formatters";

describe("formatPath", () => {
  // Worktree path detection (no projectRoot needed)
  it("strips absolute worktree prefix", () => {
    expect(formatPath("/workspace/proj/.orkestra/.worktrees/task-123/src/App.tsx")).toBe(
      "src/App.tsx",
    );
  });

  it("strips worktree prefix for root-level file", () => {
    expect(formatPath("/workspace/proj/.orkestra/.worktrees/task-123/package.json")).toBe(
      "package.json",
    );
  });

  // projectRoot stripping
  it("strips projectRoot prefix from absolute path", () => {
    expect(formatPath("/workspace/proj/src/App.tsx", "/workspace/proj")).toBe("src/App.tsx");
  });

  it("handles projectRoot with trailing slash", () => {
    expect(formatPath("/workspace/proj/src/App.tsx", "/workspace/proj/")).toBe("src/App.tsx");
  });

  it("returns basename when path equals projectRoot", () => {
    expect(formatPath("/workspace/proj", "/workspace/proj")).toBe("proj");
  });

  // Fallback to existing truncation (path must be >50 chars to trigger truncation)
  it("falls back to last-3-segments for non-matching long paths", () => {
    expect(formatPath("/workspace/projects/myapp/src/components/deeply/nested/file.ts")).toBe(
      ".../deeply/nested/file.ts",
    );
  });

  it("returns short non-matching path unchanged", () => {
    expect(formatPath("/some/path/file.ts")).toBe("/some/path/file.ts");
  });

  // Short paths pass through unchanged
  it("returns short paths unchanged", () => {
    expect(formatPath("src/App.tsx")).toBe("src/App.tsx");
  });

  // Max-length truncation on relativized paths
  it("truncates long relative paths after relativization", () => {
    const longPath = `/w/.orkestra/.worktrees/t/${"a/".repeat(30)}file.ts`;
    const result = formatPath(longPath);
    expect(result.length).toBeLessThanOrEqual(53); // ".../" + 3 segments ≤ 53 chars
  });

  // Paths outside project root fall back to length-based truncation
  it("falls back when path does not start with projectRoot", () => {
    // Path is >50 chars and doesn't match the projectRoot — gets 3-segment truncation
    expect(
      formatPath(
        "/other/workspace/projects/src/deeply/nested/components/file.ts",
        "/workspace/proj",
      ),
    ).toBe(".../nested/components/file.ts");
  });
});
