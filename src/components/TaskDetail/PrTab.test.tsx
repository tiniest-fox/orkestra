import { render, screen } from "@testing-library/react";
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

  it("shows CI checks with statuses", () => {
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

    expect(screen.getByText("Checks")).toBeInTheDocument();
    expect(screen.getByText("tests")).toBeInTheDocument();
    expect(screen.getByText("lint")).toBeInTheDocument();
    expect(screen.getByText("build")).toBeInTheDocument();
  });

  it("shows reviews with author and state", () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [],
      reviews: [
        { author: "alice", state: "APPROVED" },
        { author: "bob", state: "CHANGES_REQUESTED" },
        { author: "carol", state: "COMMENTED" },
      ],
      comments: [],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    expect(screen.getByText("Reviews")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("requested changes")).toBeInTheDocument();
    expect(screen.getByText("carol")).toBeInTheDocument();
    expect(screen.getByText("commented")).toBeInTheDocument();
  });

  it("shows comments with author and file context", () => {
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
        },
        {
          id: 2,
          author: "bob",
          body: "Consider refactoring",
          path: "src/lib.rs",
          created_at: new Date().toISOString(),
        },
        {
          id: 3,
          author: "carol",
          body: "General comment",
          created_at: new Date().toISOString(),
        },
      ],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    // Comments section header with count
    expect(screen.getByText("Comments (3)")).toBeInTheDocument();

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
});
