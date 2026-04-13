// Tests for StatusSymbol — status symbol and color selection by task state.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../../test/mocks/fixtures";
import type { PrStatus } from "../../types/workflow";
import { StatusSymbol } from "./StatusSymbol";

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
    render(<StatusSymbol task={task} />);
    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("renders ↑ when task is done and PR state is open", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    render(<StatusSymbol task={task} prStatus={makePrStatus("open")} />);
    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("renders ✓ when task is done and PR state is merged", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    render(<StatusSymbol task={task} prStatus={makePrStatus("merged")} />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("renders ✕ when task is done and PR state is closed", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    render(<StatusSymbol task={task} prStatus={makePrStatus("closed")} />);
    expect(screen.getByText("✕")).toBeInTheDocument();
  });
});
