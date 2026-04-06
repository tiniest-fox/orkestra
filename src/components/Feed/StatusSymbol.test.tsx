// Tests for StatusSymbol — status symbol and color selection by task state.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockWorkflowTaskView } from "../../test/mocks/fixtures";
import { StatusSymbol } from "./StatusSymbol";

const mockGetPrStatus = vi.fn();

vi.mock("../../providers/PrStatusProvider", () => ({
  usePrStatus: () => ({ getPrStatus: mockGetPrStatus }),
}));

beforeEach(() => {
  mockGetPrStatus.mockReset();
  mockGetPrStatus.mockReturnValue(undefined);
});

describe("StatusSymbol — chatting task", () => {
  it("renders ⋯ when task is chatting", () => {
    const task = createMockWorkflowTaskView({
      derived: { is_chatting: true },
    });
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("⋯")).toBeInTheDocument();
  });

  it("renders ⋯ when chat_agent_active (takes priority over working)", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "agent_working", stage: "work" },
      derived: { chat_agent_active: true, is_working: true },
    });
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("⋯")).toBeInTheDocument();
  });

  it("renders ⋯ for chatting even when needs_review is true", () => {
    const task = createMockWorkflowTaskView({
      derived: { is_chatting: true, needs_review: true },
    });
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("⋯")).toBeInTheDocument();
  });
});

describe("StatusSymbol — done task", () => {
  it("renders ○ when task is done and has no pr_url", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
    });
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("○")).toBeInTheDocument();
  });

  it("renders ↑ when task is done and has pr_url with no PR status fetched", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    mockGetPrStatus.mockReturnValue(undefined);
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("renders ↑ when task is done and PR state is open", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    mockGetPrStatus.mockReturnValue({ state: "open" });
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("renders ✓ when task is done and PR state is merged", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    mockGetPrStatus.mockReturnValue({ state: "merged" });
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("renders ✕ when task is done and PR state is closed", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    mockGetPrStatus.mockReturnValue({ state: "closed" });
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("✕")).toBeInTheDocument();
  });
});
