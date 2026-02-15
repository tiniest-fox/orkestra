import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrStatus } from "../../types/workflow";
import { PrTab } from "./PrTab";

// Mock status values
const mockStatuses: Map<string, PrStatus> = new Map();
const mockLoadingIds: Set<string> = new Set();

vi.mock("../../providers", () => ({
  usePrStatus: () => ({
    getPrStatus: (taskId: string) => mockStatuses.get(taskId),
    isLoading: (taskId: string) => mockLoadingIds.has(taskId),
    requestFetch: vi.fn(),
    setActivePoll: vi.fn(),
  }),
}));

describe("PrTab", () => {
  beforeEach(() => {
    mockStatuses.clear();
    mockLoadingIds.clear();
  });

  it("renders a link to the PR", () => {
    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    const link = screen.getByRole("link", { name: /view on github/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://github.com/test/repo/pull/42");
  });

  it("opens link in new tab", () => {
    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    const link = screen.getByRole("link", { name: /view on github/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows loading state when no status and loading", () => {
    mockLoadingIds.add("task-1");

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    // Both badge and inline text show "Loading..." when loading with no status
    const loadingElements = screen.getAllByText("Loading...");
    expect(loadingElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows open state badge", () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [],
      reviews: [],
      comments: [],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("shows merged state badge", () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "merged",
      checks: [],
      reviews: [],
      comments: [],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    expect(screen.getByText("Merged")).toBeInTheDocument();
  });

  it("shows closed state badge", () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "closed",
      checks: [],
      reviews: [],
      comments: [],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("shows CI checks with statuses", async () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [
        { name: "tests", status: "success" },
        { name: "lint", status: "failure" },
        { name: "build", status: "pending" },
      ],
      reviews: [],
      comments: [],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    // Checks section is collapsed by default - expand it
    const checksHeader = screen.getByRole("button", { name: /checks/i });
    expect(checksHeader).toBeInTheDocument();
    await userEvent.click(checksHeader);

    expect(screen.getByText("tests")).toBeInTheDocument();
    expect(screen.getByText("lint")).toBeInTheDocument();
    expect(screen.getByText("build")).toBeInTheDocument();
  });

  it("shows reviews with author and state", async () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [],
      reviews: [
        {
          id: 1,
          author: "alice",
          state: "APPROVED",
          body: null,
          submitted_at: new Date().toISOString(),
        },
        {
          id: 2,
          author: "bob",
          state: "CHANGES_REQUESTED",
          body: null,
          submitted_at: new Date().toISOString(),
        },
        {
          id: 3,
          author: "carol",
          state: "COMMENTED",
          body: null,
          submitted_at: new Date().toISOString(),
        },
      ],
      comments: [],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    // Reviews section is collapsed by default - expand it
    const reviewsHeader = screen.getByRole("button", { name: /reviews/i });
    expect(reviewsHeader).toBeInTheDocument();
    await userEvent.click(reviewsHeader);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("requested changes")).toBeInTheDocument();
    expect(screen.getByText("carol")).toBeInTheDocument();
    expect(screen.getByText("commented")).toBeInTheDocument();
  });

  it("shows standalone comments with author and file context", async () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [],
      reviews: [],
      comments: [
        {
          id: 1,
          author: "alice",
          body: "Looks good",
          path: "src/main.rs",
          line: 42,
          created_at: new Date().toISOString(),
          review_id: null,
        },
        {
          id: 2,
          author: "bob",
          body: "Consider refactoring",
          path: "src/lib.rs",
          line: null,
          created_at: new Date().toISOString(),
          review_id: null,
        },
        {
          id: 3,
          author: "carol",
          body: "General comment",
          path: null,
          line: null,
          created_at: new Date().toISOString(),
          review_id: null,
        },
      ],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    // Standalone Comments section is collapsed by default - expand it
    const commentsHeader = screen.getByRole("button", { name: /standalone comments/i });
    expect(commentsHeader).toBeInTheDocument();
    await userEvent.click(commentsHeader);

    // First comment: author, path with line, body
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("src/main.rs:42")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();

    // Second comment: author, path without line, body
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("src/lib.rs")).toBeInTheDocument();
    expect(screen.getByText("Consider refactoring")).toBeInTheDocument();

    // Third comment: author, no path, body
    expect(screen.getByText("carol")).toBeInTheDocument();
    expect(screen.getByText("General comment")).toBeInTheDocument();
  });

  it("shows empty state when no checks or reviews", () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [],
      reviews: [],
      comments: [],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    expect(screen.getByText("No checks, reviews, or comments yet")).toBeInTheDocument();
  });

  it("calls onSelectionChange when selecting a comment", async () => {
    const onSelectionChange = vi.fn();
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [],
      reviews: [],
      comments: [
        {
          id: 123,
          author: "alice",
          body: "Test comment",
          path: null,
          line: null,
          created_at: new Date().toISOString(),
          review_id: null,
        },
      ],
      fetched_at: new Date().toISOString(),
    });

    render(
      <PrTab
        prUrl="https://github.com/test/repo/pull/42"
        taskId="task-1"
        selectedCommentIds={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );

    // Expand standalone comments section
    const commentsHeader = screen.getByRole("button", { name: /standalone comments/i });
    await userEvent.click(commentsHeader);

    // Click the checkbox
    const checkbox = screen.getByRole("checkbox");
    await userEvent.click(checkbox);

    // Verify callback was called with Set containing the comment ID
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const calledWith = onSelectionChange.mock.calls[0][0];
    expect(calledWith).toBeInstanceOf(Set);
    expect(calledWith.has(123)).toBe(true);
  });

  it("calls onSelectionChange when deselecting a comment", async () => {
    const onSelectionChange = vi.fn();
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [],
      reviews: [],
      comments: [
        {
          id: 456,
          author: "bob",
          body: "Another comment",
          path: null,
          line: null,
          created_at: new Date().toISOString(),
          review_id: null,
        },
      ],
      fetched_at: new Date().toISOString(),
    });

    render(
      <PrTab
        prUrl="https://github.com/test/repo/pull/42"
        taskId="task-1"
        selectedCommentIds={new Set([456])}
        onSelectionChange={onSelectionChange}
      />,
    );

    // Expand standalone comments section
    const commentsHeader = screen.getByRole("button", { name: /standalone comments/i });
    await userEvent.click(commentsHeader);

    // Click the checkbox to deselect
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);

    // Verify callback was called with Set NOT containing the comment ID
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const calledWith = onSelectionChange.mock.calls[0][0];
    expect(calledWith).toBeInstanceOf(Set);
    expect(calledWith.has(456)).toBe(false);
  });

  it("renders collapsible sections collapsed by default", () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [{ name: "tests", status: "success" }],
      reviews: [
        {
          id: 1,
          author: "alice",
          state: "APPROVED",
          body: null,
          submitted_at: new Date().toISOString(),
        },
      ],
      comments: [
        {
          id: 1,
          author: "bob",
          body: "Test",
          path: null,
          line: null,
          created_at: new Date().toISOString(),
          review_id: null,
        },
      ],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    // Section headers should be visible
    expect(screen.getByRole("button", { name: /checks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reviews/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /standalone comments/i })).toBeInTheDocument();

    // Content inside sections should NOT be visible (collapsed)
    expect(screen.queryByText("tests")).not.toBeInTheDocument();
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });

  describe("comment grouping", () => {
    it("nests comments under their parent review", async () => {
      mockStatuses.set("task-1", {
        url: "https://github.com/test/repo/pull/42",
        state: "open",
        checks: [],
        reviews: [
          {
            id: 100,
            author: "alice",
            state: "APPROVED",
            body: null,
            submitted_at: new Date().toISOString(),
          },
        ],
        comments: [
          {
            id: 1,
            author: "alice",
            body: "Nested comment",
            path: "src/main.rs",
            line: 10,
            created_at: new Date().toISOString(),
            review_id: 100, // Matches alice's review
          },
        ],
        fetched_at: new Date().toISOString(),
      });

      render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

      // Expand Reviews section
      await userEvent.click(screen.getByRole("button", { name: /reviews/i }));

      // Comment count shown on review row
      expect(screen.getByText("(1 comment)")).toBeInTheDocument();

      // Comment NOT visible until review expanded
      expect(screen.queryByText("Nested comment")).not.toBeInTheDocument();

      // No standalone comments section (all comments nested)
      expect(
        screen.queryByRole("button", { name: /standalone comments/i }),
      ).not.toBeInTheDocument();
    });

    it("shows orphaned comments in standalone section", async () => {
      mockStatuses.set("task-1", {
        url: "https://github.com/test/repo/pull/42",
        state: "open",
        checks: [],
        reviews: [
          {
            id: 100,
            author: "alice",
            state: "APPROVED",
            body: null,
            submitted_at: new Date().toISOString(),
          },
        ],
        comments: [
          {
            id: 1,
            author: "bob",
            body: "Orphaned comment",
            path: null,
            line: null,
            created_at: new Date().toISOString(),
            review_id: 999, // Points to non-existent review
          },
        ],
        fetched_at: new Date().toISOString(),
      });

      render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

      // Expand Standalone Comments section
      const standaloneHeader = screen.getByRole("button", { name: /standalone comments/i });
      expect(standaloneHeader).toBeInTheDocument();
      await userEvent.click(standaloneHeader);

      // Orphaned comment appears in standalone section
      expect(screen.getByText("Orphaned comment")).toBeInTheDocument();
    });

    it("expands review to show nested comments", async () => {
      mockStatuses.set("task-1", {
        url: "https://github.com/test/repo/pull/42",
        state: "open",
        checks: [],
        reviews: [
          {
            id: 100,
            author: "alice",
            state: "COMMENTED",
            body: null,
            submitted_at: new Date().toISOString(),
          },
        ],
        comments: [
          {
            id: 1,
            author: "alice",
            body: "First nested comment",
            path: "src/lib.rs",
            line: 5,
            created_at: new Date().toISOString(),
            review_id: 100,
          },
          {
            id: 2,
            author: "alice",
            body: "Second nested comment",
            path: "src/lib.rs",
            line: 10,
            created_at: new Date().toISOString(),
            review_id: 100,
          },
        ],
        fetched_at: new Date().toISOString(),
      });

      render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

      // Expand Reviews section first
      await userEvent.click(screen.getByRole("button", { name: /reviews/i }));

      // Comments not visible initially (review row is collapsed)
      expect(screen.queryByText("First nested comment")).not.toBeInTheDocument();

      // The review row shows the comment count - find the row containing it and click the chevron
      const commentCountText = screen.getByText("(2 comments)");
      // The comment count is in a span inside the flex row div
      const flexRow = commentCountText.closest("div");
      expect(flexRow).not.toBeNull();

      // The chevron button is inside the flex row
      const chevronButton = flexRow?.querySelector("button");
      expect(chevronButton).not.toBeNull();
      if (chevronButton) {
        await userEvent.click(chevronButton);
      }

      // Now comments are visible
      expect(screen.getByText("First nested comment")).toBeInTheDocument();
      expect(screen.getByText("Second nested comment")).toBeInTheDocument();
    });

    it("shows selected count badge when review is collapsed with selected comments", async () => {
      const onSelectionChange = vi.fn();
      mockStatuses.set("task-1", {
        url: "https://github.com/test/repo/pull/42",
        state: "open",
        checks: [],
        reviews: [
          {
            id: 100,
            author: "alice",
            state: "COMMENTED",
            body: null,
            submitted_at: new Date().toISOString(),
          },
        ],
        comments: [
          {
            id: 1,
            author: "alice",
            body: "Comment one",
            path: null,
            line: null,
            created_at: new Date().toISOString(),
            review_id: 100,
          },
          {
            id: 2,
            author: "alice",
            body: "Comment two",
            path: null,
            line: null,
            created_at: new Date().toISOString(),
            review_id: 100,
          },
        ],
        fetched_at: new Date().toISOString(),
      });

      // Render with 2 comments pre-selected
      render(
        <PrTab
          prUrl="https://github.com/test/repo/pull/42"
          taskId="task-1"
          selectedCommentIds={new Set([1, 2])}
          onSelectionChange={onSelectionChange}
        />,
      );

      // Expand Reviews section
      await userEvent.click(screen.getByRole("button", { name: /reviews/i }));

      // Badge shows "2 selected" (review is collapsed by default)
      expect(screen.getByText("2 selected")).toBeInTheDocument();
    });
  });
});
