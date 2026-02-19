/**
 * Tests for InlineCommentBlock component.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PrComment } from "../../types/workflow";
import { InlineCommentBlock } from "./InlineCommentBlock";

const mockComment: PrComment = {
  id: 1,
  author: "alice",
  body: "Looks good",
  path: "src/main.rs",
  line: 42,
  created_at: new Date().toISOString(),
  review_id: null,
};

describe("InlineCommentBlock", () => {
  it("renders single comment with author, body, and timestamp", () => {
    render(<InlineCommentBlock comments={[mockComment]} />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
    // Timestamp is formatted, so check it exists (partial match)
    expect(screen.getByText(/\w+ \d+/)).toBeInTheDocument();
  });

  it("renders multiple stacked comments in order", () => {
    const comments: PrComment[] = [
      { ...mockComment, id: 1, author: "alice", body: "First comment" },
      { ...mockComment, id: 2, author: "bob", body: "Second comment" },
      { ...mockComment, id: 3, author: "charlie", body: "Third comment" },
    ];

    render(<InlineCommentBlock comments={comments} />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("charlie")).toBeInTheDocument();
    expect(screen.getByText("First comment")).toBeInTheDocument();
    expect(screen.getByText("Second comment")).toBeInTheDocument();
    expect(screen.getByText("Third comment")).toBeInTheDocument();
  });

  it("renders nothing when comments array is empty", () => {
    const { container } = render(<InlineCommentBlock comments={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("preserves whitespace in long body text", () => {
    const multilineComment: PrComment = {
      ...mockComment,
      body: "Line 1\nLine 2\n  Indented line",
    };

    render(<InlineCommentBlock comments={[multilineComment]} />);

    const bodyElement = screen.getByText(/Line 1/);
    expect(bodyElement).toHaveClass("whitespace-pre-wrap");
  });

  it("applies info-tinted background styling", () => {
    render(<InlineCommentBlock comments={[mockComment]} />);

    const commentContainer = screen.getByText("Looks good").closest("div[class*='bg-info']");
    expect(commentContainer).toHaveClass("bg-info-50");
    expect(commentContainer).toHaveClass("border-l-2");
    expect(commentContainer).toHaveClass("border-info-400");
  });
});
