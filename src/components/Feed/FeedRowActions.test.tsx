//! Tests for FeedRowActions — Approve button behavior.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockWorkflowConfig, createMockWorkflowTaskView } from "../../test/mocks/fixtures";

const mockConfig = createMockWorkflowConfig();

vi.mock("../../providers", () => ({
  useWorkflowConfig: vi.fn(() => mockConfig),
}));

import { FeedRowActions } from "./FeedRowActions";

function makeProps(overrides?: Partial<Parameters<typeof FeedRowActions>[0]>) {
  return {
    task: createMockWorkflowTaskView({ derived: { needs_review: true } }),
    onReview: vi.fn(),
    onAnswer: vi.fn(),
    onApprove: vi.fn(),
    onMerge: vi.fn(),
    onOpenPr: vi.fn(),
    onArchive: vi.fn(),
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
