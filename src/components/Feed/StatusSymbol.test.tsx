// Tests for StatusSymbol — status symbol and color selection by task state.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../../test/mocks/fixtures";
import type { PrStatus } from "../../types/workflow";
import { StatusSymbol } from "./StatusSymbol";

function makePrStatus(overrides: Partial<PrStatus> & Pick<PrStatus, "state">): PrStatus {
  return {
    url: "https://github.com/owner/repo/pull/42",
    checks: [],
    reviews: [],
    comments: [],
    fetched_at: "2025-01-01T00:00:00Z",
    mergeable: true,
    merge_state_status: null,
    ...overrides,
  };
}

describe("StatusSymbol — chat task", () => {
  it("renders * with animate-spin-bounce and accent colors when is_chat and assistant_active", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { assistant_active: true },
    });
    render(<StatusSymbol task={task} />);
    const symbol = screen.getByText("*");
    expect(symbol).toBeInTheDocument();
    expect(symbol).toHaveClass("text-accent");
    expect(symbol).toHaveClass("animate-spin-bounce");
  });

  it("renders ⦿ with purple colors when is_chat and needs_review", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { needs_review: true },
    });
    render(<StatusSymbol task={task} />);
    const symbol = screen.getByText("⦿");
    expect(symbol).toBeInTheDocument();
    expect(symbol).toHaveClass("text-status-purple");
  });

  it("renders ? with info colors when is_chat and has_questions", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { has_questions: true },
    });
    render(<StatusSymbol task={task} />);
    const symbol = screen.getByText("?");
    expect(symbol).toBeInTheDocument();
    expect(symbol).toHaveClass("text-status-info");
  });

  it("renders ◉ with quaternary colors when is_chat and idle", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { assistant_active: false, is_preparing: false },
    });
    render(<StatusSymbol task={task} />);
    const symbol = screen.getByText("◉");
    expect(symbol).toBeInTheDocument();
    expect(symbol).toHaveClass("text-text-quaternary");
  });

  it("renders ! with error colors when is_chat and is_failed", () => {
    const task = createMockWorkflowTaskView({
      is_chat: true,
      derived: { is_failed: true },
    });
    render(<StatusSymbol task={task} />);
    const symbol = screen.getByText("!");
    expect(symbol).toBeInTheDocument();
    expect(symbol).toHaveClass("text-status-error");
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

  it("renders SVG with success colors when PR is open with no checks (passing)", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol task={task} prStatus={makePrStatus({ state: "open" })} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-success");
  });

  it("renders ✓ when task is done and PR state is merged", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    render(<StatusSymbol task={task} prStatus={makePrStatus({ state: "merged" })} />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("renders ✕ when task is done and PR state is closed", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    render(<StatusSymbol task={task} prStatus={makePrStatus({ state: "closed" })} />);
    expect(screen.getByText("✕")).toBeInTheDocument();
  });

  it("renders SVG with success colors when PR is open and all checks pass", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          checks: [{ name: "ci", status: "success" }],
        })}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-success");
  });

  it("renders SVG with warning colors when PR has pending checks", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          checks: [{ name: "ci", status: "pending" }],
        })}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-warning");
  });

  it("renders SVG with error colors when PR has failing checks", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          checks: [{ name: "ci", status: "failure" }],
        })}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-error");
  });

  it("renders SVG with warning colors when PR has merge conflicts", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          mergeable: false,
          merge_state_status: "DIRTY",
        })}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-warning");
  });

  it("conflicts take precedence over failing checks — renders warning (not error) colors", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          checks: [{ name: "ci", status: "failure" }],
          mergeable: false,
          merge_state_status: "DIRTY",
        })}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // Conflict takes precedence — warning, not error
    expect(svg?.parentElement).toHaveClass("text-status-warning");
    expect(svg?.parentElement).not.toHaveClass("text-status-error");
  });

  it("skipped checks are treated as passing — renders SVG with success colors", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          checks: [{ name: "ci", status: "skipped" }],
        })}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-success");
  });
});
