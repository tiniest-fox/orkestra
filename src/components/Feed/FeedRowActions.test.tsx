// Tests for FeedRowActions — Approve button behavior and merged PR archive button.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockWorkflowConfig, createMockWorkflowTaskView } from "../../test/mocks/fixtures";
import type { PrStatus } from "../../types/workflow";

const mockConfig = createMockWorkflowConfig();

vi.mock("../../providers", () => ({
  useWorkflowConfig: vi.fn(() => mockConfig),
}));

import { FeedRowActions } from "./FeedRowActions";

function makePrStatus(state: PrStatus["state"]): PrStatus {
  return {
    url: "https://github.com/owner/repo/pull/42",
    state,
    checks: [],
    reviews: [],
    comments: [],
    fetched_at: "2025-01-01T00:00:00Z",
    mergeable: true,
    merge_state_status: null,
  };
}

function makeProps(overrides?: Partial<Parameters<typeof FeedRowActions>[0]>) {
  return {
    task: createMockWorkflowTaskView({ derived: { needs_review: true } }),
    onReview: vi.fn(),
    onAnswer: vi.fn(),
    onApprove: vi.fn(),
    onMerge: vi.fn(),
    onOpenPr: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe("FeedRowActions — Approve button", () => {
  it("calls onApprove when Approve is clicked", () => {
    const props = makeProps();
    render(<FeedRowActions {...props} />);

    fireEvent.click(screen.getByText("Approve"));

    expect(props.onApprove).toHaveBeenCalledTimes(1);
  });

  it("does not propagate click to parent when Approve is clicked", () => {
    const parentClick = vi.fn();
    const props = makeProps();

    render(
      // biome-ignore lint/a11y/useSemanticElements: simulating parent row onClick in test
      // biome-ignore lint/a11y/useKeyWithClickEvents: test-only wrapper, not a real interactive element
      // biome-ignore lint/a11y/useFocusableInteractive: test-only wrapper, not a real interactive element
      <div role="button" onClick={parentClick}>
        <FeedRowActions {...props} />
      </div>,
    );

    fireEvent.click(screen.getByText("Approve"));

    expect(props.onApprove).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("does not call onApprove when Review is clicked", () => {
    const props = makeProps();
    render(<FeedRowActions {...props} />);

    fireEvent.click(screen.getByText("Review"));

    expect(props.onApprove).not.toHaveBeenCalled();
    expect(props.onReview).toHaveBeenCalledTimes(1);
  });
});

describe("FeedRowActions — chat task", () => {
  it("renders Archive and Delete buttons for chat tasks", () => {
    const props = makeProps({
      task: createMockWorkflowTaskView({ is_chat: true, derived: { needs_review: true } }),
    });
    render(<FeedRowActions {...props} />);
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("calls onArchive when Archive is clicked on a chat task", () => {
    const props = makeProps({
      task: createMockWorkflowTaskView({ is_chat: true }),
    });
    render(<FeedRowActions {...props} />);
    fireEvent.click(screen.getByText("Archive"));
    expect(props.onArchive).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete when Delete is clicked on a chat task", () => {
    const props = makeProps({
      task: createMockWorkflowTaskView({ is_chat: true }),
    });
    render(<FeedRowActions {...props} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("FeedRowActions — Archive button (merged PR)", () => {
  it("renders Archive button when task is done with merged PR", () => {
    const props = makeProps({
      task: createMockWorkflowTaskView({
        state: { type: "done" },
        pr_url: "https://github.com/owner/repo/pull/42",
      }),
      prStatus: makePrStatus("merged"),
    });
    render(<FeedRowActions {...props} />);

    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.queryByText("PR")).not.toBeInTheDocument();
  });

  it("renders PR button when task is done with open PR", () => {
    const props = makeProps({
      task: createMockWorkflowTaskView({
        state: { type: "done" },
        pr_url: "https://github.com/owner/repo/pull/42",
      }),
      prStatus: makePrStatus("open"),
    });
    render(<FeedRowActions {...props} />);

    expect(screen.getByText("PR")).toBeInTheDocument();
    expect(screen.queryByText("Archive")).not.toBeInTheDocument();
  });

  it("calls onArchive when Archive is clicked", () => {
    const props = makeProps({
      task: createMockWorkflowTaskView({
        state: { type: "done" },
        pr_url: "https://github.com/owner/repo/pull/42",
      }),
      prStatus: makePrStatus("merged"),
    });
    render(<FeedRowActions {...props} />);

    fireEvent.click(screen.getByText("Archive"));

    expect(props.onArchive).toHaveBeenCalledTimes(1);
  });

  it("falls back to PR button when PrStatus not loaded", () => {
    const props = makeProps({
      task: createMockWorkflowTaskView({
        state: { type: "done" },
        pr_url: "https://github.com/owner/repo/pull/42",
      }),
    });
    render(<FeedRowActions {...props} />);

    expect(screen.getByText("PR")).toBeInTheDocument();
    expect(screen.queryByText("Archive")).not.toBeInTheDocument();
  });
});
