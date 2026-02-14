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

  it("shows empty state when no checks or reviews", () => {
    mockStatuses.set("task-1", {
      url: "https://github.com/test/repo/pull/42",
      state: "open",
      checks: [],
      reviews: [],
      fetched_at: new Date().toISOString(),
    });

    render(<PrTab prUrl="https://github.com/test/repo/pull/42" taskId="task-1" />);

    expect(screen.getByText("No checks or reviews yet")).toBeInTheDocument();
  });
});
