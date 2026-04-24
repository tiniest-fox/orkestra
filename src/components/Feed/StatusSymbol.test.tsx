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

describe("StatusSymbol — chat task", () => {
  it("renders ◉ with accent colors and pulse when is_chat and assistant_active", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { assistant_active: true },
    });
    render(<StatusSymbol task={task} />);
    const symbol = screen.getByText("◉");
    expect(symbol).toBeInTheDocument();
    expect(symbol).toHaveClass("text-accent");
    expect(symbol.className).toContain("forge-pulse-opacity");
  });

  it("renders ◉ with tertiary colors and no pulse when is_chat and assistant not active", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { assistant_active: false },
    });
    render(<StatusSymbol task={task} />);
    const symbol = screen.getByText("◉");
    expect(symbol).toBeInTheDocument();
    expect(symbol).toHaveClass("text-text-tertiary");
    expect(symbol.className).not.toContain("forge-pulse-opacity");
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
