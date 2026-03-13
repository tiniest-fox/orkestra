/**
 * Tests for DiffContent and FileSection — comment grouping, context collapsing, and rendering logic.
 *
 * DiffContent uses Virtua which requires a real scroll container with layout.
 * jsdom has no layout engine, so the virtualizer renders 0 items. We test FileSection directly
 * for per-file rendering behavior, and test DiffContent only for the empty-state branch.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HighlightedFileDiff, HighlightedLine } from "../../hooks/useDiff";
import type { PrComment } from "../../types/workflow";
import { DiffContent } from "./DiffContent";
import { FileSection } from "./FileSection";

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
// DiffContent — empty state (virtualizer-independent)
// ============================================================================

describe("DiffContent", () => {
  it("renders empty state when no files", () => {
    render(
      <DiffContent
        files={[]}
        comments={[]}
        activePath={null}
        collapsedPaths={new Set()}
        scrollElement={null}
        onToggleCollapsed={noop}
        onActivePathChange={noop}
      />,
    );
    expect(screen.getByText("No changes.")).toBeInTheDocument();
  });
});

// ============================================================================
// FileSection — per-file rendering behavior
// ============================================================================

function renderFileSection(
  file: HighlightedFileDiff,
  opts: {
    commentsByLine?: Map<number, PrComment[]>;
    collapsedPaths?: Set<string>;
    onToggleCollapsed?: () => void;
  } = {},
) {
  return render(
    <FileSection
      file={file}
      commentsByLine={opts.commentsByLine ?? new Map()}
      draftsByLine={new Map()}
      isActive={false}
      isCollapsed={opts.collapsedPaths?.has(file.path) ?? false}
      onToggleCollapsed={opts.onToggleCollapsed ?? noop}
      activeCommentLine={null}
      fileMatches={[]}
      currentMatch={null}
    />,
  );
}

describe("FileSection", () => {
  it("renders file header with path", () => {
    const file = makeFile("src/foo.ts", [makeHunk([makeLine("add", "hello", { newLine: 1 })])]);
    renderFileSection(file);
    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
  });

  it("renders binary file message", () => {
    const file = makeFile("image.png", [], { isBinary: true });
    renderFileSection(file);
    expect(screen.getByText("Binary file")).toBeInTheDocument();
    expect(screen.getByText("image.png")).toBeInTheDocument();
  });

  it("renders file headers with multiple files", () => {
    const fileA = makeFile("src/foo.ts", [makeHunk([makeLine("add", "hello", { newLine: 1 })])]);
    const fileB = makeFile("src/bar.ts", [makeHunk([makeLine("add", "world", { newLine: 1 })])]);
    render(
      <>
        <FileSection
          file={fileA}
          commentsByLine={new Map()}
          draftsByLine={new Map()}
          isActive={false}
          isCollapsed={false}
          onToggleCollapsed={noop}
          activeCommentLine={null}
          fileMatches={[]}
          currentMatch={null}
        />
        <FileSection
          file={fileB}
          commentsByLine={new Map()}
          draftsByLine={new Map()}
          isActive={false}
          isCollapsed={false}
          onToggleCollapsed={noop}
          activeCommentLine={null}
          fileMatches={[]}
          currentMatch={null}
        />
      </>,
    );
    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
    expect(screen.getByText("src/bar.ts")).toBeInTheDocument();
  });

  it("groups comments by line number", () => {
    const file = makeFile("src/foo.ts", [
      makeHunk([
        makeLine("add", "line one", { newLine: 1 }),
        makeLine("add", "line two", { newLine: 2 }),
      ]),
    ]);

    const commentsByLine = new Map<number, PrComment[]>([
      [1, [makeComment(1, "src/foo.ts", 1, "First line comment")]],
      [2, [makeComment(2, "src/foo.ts", 2, "Second line comment")]],
    ]);

    renderFileSection(file, { commentsByLine });

    expect(screen.getByText(/First line comment/)).toBeInTheDocument();
    expect(screen.getByText(/Second line comment/)).toBeInTheDocument();
  });

  it("renders inline comments after matching lines", () => {
    const file = makeFile("src/foo.ts", [
      makeHunk([
        makeLine("add", "target line", { newLine: 5 }),
        makeLine("add", "next line", { newLine: 6 }),
      ]),
    ]);

    const commentsByLine = new Map<number, PrComment[]>([
      [5, [makeComment(1, "src/foo.ts", 5, "Comment on line 5")]],
    ]);

    renderFileSection(file, { commentsByLine });

    expect(screen.getByText(/Comment on line 5/)).toBeInTheDocument();
  });

  it("collapses context blocks longer than threshold (8)", () => {
    // Create 12 context lines — threshold is 8, so 12 > 8 triggers collapse
    const contextLines = Array.from({ length: 12 }, (_, i) =>
      makeLine("context", `ctx line ${i}`, { oldLine: i + 1, newLine: i + 1 }),
    );
    const file = makeFile("src/foo.ts", [makeHunk(contextLines)]);
    renderFileSection(file);

    // The collapsed section shows "N lines"
    expect(screen.getByText(/lines/)).toBeInTheDocument();
  });

  it("does not collapse short context blocks", () => {
    // 5 context lines — below threshold of 8, no collapsing
    const contextLines = Array.from({ length: 5 }, (_, i) =>
      makeLine("context", `ctx line ${i}`, { oldLine: i + 1, newLine: i + 1 }),
    );
    const file = makeFile("src/foo.ts", [makeHunk(contextLines)]);
    renderFileSection(file);

    // All lines render, no collapse button
    expect(screen.queryByText(/lines/)).not.toBeInTheDocument();
    expect(screen.getByText("ctx line 0")).toBeInTheDocument();
    expect(screen.getByText("ctx line 4")).toBeInTheDocument();
  });

  it("respects isCollapsed — hides hunks when collapsed", () => {
    const file = makeFile("src/foo.ts", [
      makeHunk([makeLine("add", "should be hidden", { newLine: 1 })]),
    ]);

    render(
      <FileSection
        file={file}
        commentsByLine={new Map()}
        draftsByLine={new Map()}
        isActive={false}
        isCollapsed={true}
        onToggleCollapsed={noop}
        activeCommentLine={null}
        fileMatches={[]}
        currentMatch={null}
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
      <FileSection
        file={file}
        commentsByLine={new Map()}
        draftsByLine={new Map()}
        isActive={false}
        isCollapsed={false}
        onToggleCollapsed={onToggle}
        activeCommentLine={null}
        fileMatches={[]}
        currentMatch={null}
      />,
    );

    await user.click(screen.getByText("src/foo.ts"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
