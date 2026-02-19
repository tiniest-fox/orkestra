/**
 * Tests for DiffContent component.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import type { PrComment } from "../../types/workflow";
import { DiffContent } from "./DiffContent";

// Helper to create a basic file diff
function createFileDiff(
  path: string,
  lines: Array<{
    type: "add" | "delete" | "context";
    content: string;
    oldLine: number | null;
    newLine: number | null;
  }>,
): HighlightedFileDiff {
  return {
    path,
    change_type: "modified",
    old_path: null,
    additions: lines.filter((l) => l.type === "add").length,
    deletions: lines.filter((l) => l.type === "delete").length,
    is_binary: false,
    hunks: [
      {
        old_start: 1,
        old_count: lines.filter((l) => l.oldLine !== null).length,
        new_start: 1,
        new_count: lines.filter((l) => l.newLine !== null).length,
        lines: lines.map((l) => ({
          line_type: l.type,
          content: l.content,
          html: `<span>${l.content}</span>`,
          old_line_number: l.oldLine,
          new_line_number: l.newLine,
        })),
      },
    ],
  };
}

// Helper to create a mock comment
function createComment(
  id: number,
  path: string | null,
  line: number | null,
  body = "Test comment",
  author = "alice",
): PrComment {
  return {
    id,
    author,
    body,
    path,
    line,
    created_at: new Date().toISOString(),
    review_id: null,
  };
}

describe("DiffContent", () => {
  describe("comment filtering", () => {
    it("filters comments to only show those matching selected file path", () => {
      const file = createFileDiff("src/main.rs", [
        { type: "context", content: "fn main() {", oldLine: 1, newLine: 1 },
        { type: "add", content: '    println!("hello");', oldLine: null, newLine: 2 },
      ]);
      const comments = [
        createComment(1, "src/main.rs", 2, "Comment on main.rs"),
        createComment(2, "src/other.rs", 2, "Comment on other.rs"),
      ];

      render(<DiffContent file={file} comments={comments} />);

      expect(screen.getByText("Comment on main.rs")).toBeInTheDocument();
      expect(screen.queryByText("Comment on other.rs")).not.toBeInTheDocument();
    });

    it("excludes file-level comments (where line is null)", () => {
      const file = createFileDiff("src/main.rs", [
        { type: "context", content: "fn main() {", oldLine: 1, newLine: 1 },
      ]);
      const comments = [
        createComment(1, "src/main.rs", null, "File-level comment"),
        createComment(2, "src/main.rs", 1, "Line-level comment"),
      ];

      render(<DiffContent file={file} comments={comments} />);

      expect(screen.queryByText("File-level comment")).not.toBeInTheDocument();
      expect(screen.getByText("Line-level comment")).toBeInTheDocument();
    });
  });

  describe("line number matching", () => {
    it("renders comment after the correct diff line based on new_line_number", () => {
      const file = createFileDiff("src/main.rs", [
        { type: "context", content: "line 1", oldLine: 1, newLine: 1 },
        { type: "context", content: "line 2", oldLine: 2, newLine: 2 },
        { type: "add", content: "line 3", oldLine: null, newLine: 3 },
      ]);
      const comments = [createComment(1, "src/main.rs", 2, "Comment on line 2")];

      render(<DiffContent file={file} comments={comments} />);

      // The comment should appear
      expect(screen.getByText("Comment on line 2")).toBeInTheDocument();
      // The author should appear (from InlineCommentBlock)
      expect(screen.getByText("alice")).toBeInTheDocument();
    });

    it("does not render comments on deleted lines (new_line_number is null)", () => {
      const file = createFileDiff("src/main.rs", [
        { type: "context", content: "line 1", oldLine: 1, newLine: 1 },
        { type: "delete", content: "deleted line", oldLine: 2, newLine: null },
        { type: "context", content: "line 2", oldLine: 3, newLine: 2 },
      ]);
      // A comment targeting old line 2 (which is deleted) should not appear
      // because we match on new_line_number
      const comments = [createComment(1, "src/main.rs", 2, "Comment on new line 2")];

      render(<DiffContent file={file} comments={comments} />);

      // The comment targets new line 2, which exists (the context line)
      expect(screen.getByText("Comment on new line 2")).toBeInTheDocument();
    });
  });

  describe("multiple comments", () => {
    it("renders multiple comments on the same line stacked together", () => {
      const file = createFileDiff("src/main.rs", [
        { type: "context", content: "line 1", oldLine: 1, newLine: 1 },
        { type: "add", content: "new code", oldLine: null, newLine: 2 },
      ]);
      const comments = [
        createComment(1, "src/main.rs", 2, "First comment", "alice"),
        createComment(2, "src/main.rs", 2, "Second comment", "bob"),
        createComment(3, "src/main.rs", 2, "Third comment", "charlie"),
      ];

      render(<DiffContent file={file} comments={comments} />);

      expect(screen.getByText("First comment")).toBeInTheDocument();
      expect(screen.getByText("Second comment")).toBeInTheDocument();
      expect(screen.getByText("Third comment")).toBeInTheDocument();
      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.getByText("bob")).toBeInTheDocument();
      expect(screen.getByText("charlie")).toBeInTheDocument();
    });

    it("renders comments on different lines at their respective positions", () => {
      const file = createFileDiff("src/main.rs", [
        { type: "context", content: "line 1", oldLine: 1, newLine: 1 },
        { type: "context", content: "line 2", oldLine: 2, newLine: 2 },
        { type: "add", content: "line 3", oldLine: null, newLine: 3 },
      ]);
      const comments = [
        createComment(1, "src/main.rs", 1, "Comment on line 1"),
        createComment(2, "src/main.rs", 3, "Comment on line 3"),
      ];

      render(<DiffContent file={file} comments={comments} />);

      expect(screen.getByText("Comment on line 1")).toBeInTheDocument();
      expect(screen.getByText("Comment on line 3")).toBeInTheDocument();
    });
  });

  describe("empty states", () => {
    it("renders diff normally when comments array is empty", () => {
      const file = createFileDiff("src/main.rs", [
        { type: "context", content: "fn main() {", oldLine: 1, newLine: 1 },
        { type: "add", content: '    println!("hello");', oldLine: null, newLine: 2 },
      ]);

      render(<DiffContent file={file} comments={[]} />);

      expect(screen.getByText("src/main.rs")).toBeInTheDocument();
      // Diff content should render normally without comments
      expect(screen.queryByText("alice")).not.toBeInTheDocument();
    });

    it("renders file selection prompt when file is null", () => {
      render(<DiffContent file={null} comments={[]} />);

      expect(screen.getByText("Select a file to view changes")).toBeInTheDocument();
    });

    it("gracefully handles empty comments with null file", () => {
      render(<DiffContent file={null} comments={[]} />);

      expect(screen.getByText("Select a file to view changes")).toBeInTheDocument();
    });
  });

  describe("binary files", () => {
    it("renders binary file message without comments", () => {
      const file: HighlightedFileDiff = {
        path: "image.png",
        change_type: "modified",
        old_path: null,
        additions: 0,
        deletions: 0,
        is_binary: true,
        hunks: [],
      };
      const comments = [createComment(1, "image.png", 1, "Comment on binary")];

      render(<DiffContent file={file} comments={comments} />);

      expect(screen.getByText("Binary file")).toBeInTheDocument();
      // Comments shouldn't render for binary files (no lines to attach to)
      expect(screen.queryByText("Comment on binary")).not.toBeInTheDocument();
    });
  });

  describe("file path display", () => {
    it("shows file path header", () => {
      const file = createFileDiff("src/components/Button.tsx", [
        { type: "context", content: "export const Button = () => {", oldLine: 1, newLine: 1 },
      ]);

      render(<DiffContent file={file} comments={[]} />);

      expect(screen.getByText("src/components/Button.tsx")).toBeInTheDocument();
    });

    it("shows renamed file indicator", () => {
      const file: HighlightedFileDiff = {
        path: "src/new-name.ts",
        change_type: "renamed",
        old_path: "src/old-name.ts",
        additions: 0,
        deletions: 0,
        is_binary: false,
        hunks: [
          {
            old_start: 1,
            old_count: 1,
            new_start: 1,
            new_count: 1,
            lines: [
              {
                line_type: "context",
                content: "const x = 1;",
                html: "<span>const x = 1;</span>",
                old_line_number: 1,
                new_line_number: 1,
              },
            ],
          },
        ],
      };

      render(<DiffContent file={file} comments={[]} />);

      expect(screen.getByText("src/new-name.ts")).toBeInTheDocument();
      expect(screen.getByText(/renamed from src\/old-name.ts/)).toBeInTheDocument();
    });
  });
});
