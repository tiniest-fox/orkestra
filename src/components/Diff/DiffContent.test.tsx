/**
 * Tests for DiffContent — comment grouping, context collapsing, and rendering logic.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HighlightedFileDiff, HighlightedLine } from "../../hooks/useDiff";
import type { PrComment } from "../../types/workflow";
import { DiffContent } from "./DiffContent";

// ============================================================================
// Test data builders
// ============================================================================

function makeLine(
  type: "add" | "delete" | "context",
  content: string,
  opts: { oldLine?: number; newLine?: number } = {},
): HighlightedLine {
  return {
    line_type: type,
    content,
    html: content,
    old_line_number: opts.oldLine ?? null,
    new_line_number: opts.newLine ?? null,
  };
}

function makeHunk(lines: HighlightedLine[]) {
  return {
    old_start: 1,
    old_count: lines.length,
    new_start: 1,
    new_count: lines.length,
    lines,
  };
}

function makeFile(
  path: string,
  hunks: ReturnType<typeof makeHunk>[],
  opts: { isBinary?: boolean; oldPath?: string } = {},
): HighlightedFileDiff {
  return {
    path,
    change_type: "modified",
    old_path: opts.oldPath ?? null,
    additions: 0,
    deletions: 0,
    is_binary: opts.isBinary ?? false,
    hunks,
  };
}

function makeComment(
  id: number,
  path: string | null,
  line: number | null,
  body: string,
): PrComment {
  return {
    id,
    author: "user",
    body,
    path,
    line,
    created_at: "2024-01-01T00:00:00Z",
    review_id: null,
  };
}

const noop = () => {};

// ============================================================================
// Tests
// ============================================================================

describe("DiffContent", () => {
  it("renders empty state when no files", () => {
    render(
      <DiffContent
        files={[]}
        comments={[]}
        activePath={null}
        collapsedPaths={new Set()}
        onToggleCollapsed={noop}
        onFileSectionRef={noop}
      />,
    );
    expect(screen.getByText("No changes.")).toBeInTheDocument();
  });

  it("renders file headers with paths", () => {
    const files = [
      makeFile("src/foo.ts", [makeHunk([makeLine("add", "hello", { newLine: 1 })])]),
      makeFile("src/bar.ts", [makeHunk([makeLine("add", "world", { newLine: 1 })])]),
    ];

    render(
      <DiffContent
        files={files}
        comments={[]}
        activePath={null}
        collapsedPaths={new Set()}
        onToggleCollapsed={noop}
        onFileSectionRef={noop}
      />,
    );

    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
    expect(screen.getByText("src/bar.ts")).toBeInTheDocument();
  });

  it("renders binary file message", () => {
    const files = [makeFile("image.png", [], { isBinary: true })];

    render(
      <DiffContent
        files={files}
        comments={[]}
        activePath={null}
        collapsedPaths={new Set()}
        onToggleCollapsed={noop}
        onFileSectionRef={noop}
      />,
    );

    expect(screen.getByText("Binary file")).toBeInTheDocument();
    expect(screen.getByText("image.png")).toBeInTheDocument();
  });

  it("groups comments by file path and line number", () => {
    const file = makeFile("src/foo.ts", [
      makeHunk([
        makeLine("add", "line one", { newLine: 1 }),
        makeLine("add", "line two", { newLine: 2 }),
      ]),
    ]);

    const comments = [
      makeComment(1, "src/foo.ts", 1, "First line comment"),
      makeComment(2, "src/foo.ts", 2, "Second line comment"),
      makeComment(3, "src/bar.ts", 1, "Different file comment"),
      makeComment(4, null, 1, "No path comment"),
      makeComment(5, "src/foo.ts", null, "No line comment"),
    ];

    render(
      <DiffContent
        files={[file]}
        comments={comments}
        activePath={null}
        collapsedPaths={new Set()}
        onToggleCollapsed={noop}
        onFileSectionRef={noop}
      />,
    );

    // Comments for this file's lines are shown
    expect(screen.getByText(/First line comment/)).toBeInTheDocument();
    expect(screen.getByText(/Second line comment/)).toBeInTheDocument();
    // Comments for other file or missing path/line are not shown
    expect(screen.queryByText(/Different file comment/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No path comment/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No line comment/)).not.toBeInTheDocument();
  });

  it("renders inline comments after matching lines", () => {
    const file = makeFile("src/foo.ts", [
      makeHunk([
        makeLine("add", "target line", { newLine: 5 }),
        makeLine("add", "next line", { newLine: 6 }),
      ]),
    ]);

    const comments = [makeComment(1, "src/foo.ts", 5, "Comment on line 5")];

    render(
      <DiffContent
        files={[file]}
        comments={comments}
        activePath={null}
        collapsedPaths={new Set()}
        onToggleCollapsed={noop}
        onFileSectionRef={noop}
      />,
    );

    expect(screen.getByText(/Comment on line 5/)).toBeInTheDocument();
  });

  it("collapses context blocks longer than threshold (8)", () => {
    // Create 12 context lines — threshold is 8, so 12 > 8 triggers collapse
    const contextLines = Array.from({ length: 12 }, (_, i) =>
      makeLine("context", `ctx line ${i}`, { oldLine: i + 1, newLine: i + 1 }),
    );
    const file = makeFile("src/foo.ts", [makeHunk(contextLines)]);

    render(
      <DiffContent
        files={[file]}
        comments={[]}
        activePath={null}
        collapsedPaths={new Set()}
        onToggleCollapsed={noop}
        onFileSectionRef={noop}
      />,
    );

    // The collapsed section shows "N lines"
    expect(screen.getByText(/lines/)).toBeInTheDocument();
  });

  it("does not collapse short context blocks", () => {
    // 5 context lines — below threshold of 8, no collapsing
    const contextLines = Array.from({ length: 5 }, (_, i) =>
      makeLine("context", `ctx line ${i}`, { oldLine: i + 1, newLine: i + 1 }),
    );
    const file = makeFile("src/foo.ts", [makeHunk(contextLines)]);

    render(
      <DiffContent
        files={[file]}
        comments={[]}
        activePath={null}
        collapsedPaths={new Set()}
        onToggleCollapsed={noop}
        onFileSectionRef={noop}
      />,
    );

    // All lines render, no collapse button
    expect(screen.queryByText(/lines/)).not.toBeInTheDocument();
    expect(screen.getByText("ctx line 0")).toBeInTheDocument();
    expect(screen.getByText("ctx line 4")).toBeInTheDocument();
  });

  it("respects collapsedPaths — hides hunks for collapsed files", () => {
    const file = makeFile("src/foo.ts", [
      makeHunk([makeLine("add", "should be hidden", { newLine: 1 })]),
    ]);

    render(
      <DiffContent
        files={[file]}
        comments={[]}
        activePath={null}
        collapsedPaths={new Set(["src/foo.ts"])}
        onToggleCollapsed={noop}
        onFileSectionRef={noop}
      />,
    );

    // Header is still shown
    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
    // But hunk content is hidden
    expect(screen.queryByText("should be hidden")).not.toBeInTheDocument();
  });

  it("calls onToggleCollapsed when file header is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const file = makeFile("src/foo.ts", [makeHunk([makeLine("add", "line", { newLine: 1 })])]);

    render(
      <DiffContent
        files={[file]}
        comments={[]}
        activePath={null}
        collapsedPaths={new Set()}
        onToggleCollapsed={onToggle}
        onFileSectionRef={noop}
      />,
    );

    await user.click(screen.getByText("src/foo.ts"));
    expect(onToggle).toHaveBeenCalledWith("src/foo.ts");
  });
});
