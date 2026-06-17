// Tests for StatusSymbol — status symbol and color selection by task state.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockWorkflowTaskView } from "../../test/mocks/fixtures";
import type { PrStatus, SyncStatus } from "../../types/workflow";
import { StatusSymbol } from "./StatusSymbol";

function makeSyncStatus(overrides: Partial<SyncStatus>): SyncStatus {
  return { ahead: 0, behind: 0, diverged: false, ...overrides };
}

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

  it("renders Circle with quaternary colors when PR is open with no checks and no reviews", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol task={task} prStatus={makePrStatus({ state: "open" })} />,
    );
    const svg = container.querySelector("[data-testid='icon-open']");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-text-quaternary");
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
    const svg = container.querySelector("[data-testid='icon-passing']");
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
    const svg = container.querySelector("[data-testid='icon-pending']");
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
    const svg = container.querySelector("[data-testid='icon-failing']");
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
    const svg = container.querySelector("[data-testid='icon-conflicts']");
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
    // Conflict icon (AlertTriangle) takes precedence over failing icon (CircleX)
    const svg = container.querySelector("[data-testid='icon-conflicts']");
    expect(svg).toBeInTheDocument();
    expect(container.querySelector("[data-testid='icon-failing']")).not.toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-warning");
    expect(svg?.parentElement).not.toHaveClass("text-status-error");
  });

  it("skipped checks produce no meaningful signal — renders open icon with quaternary colors", () => {
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
    const svg = container.querySelector("[data-testid='icon-open']");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-text-quaternary");
  });

  it("renders GitCompareArrows with info colors when done task is ahead of remote", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({ state: "open", checks: [{ name: "ci", status: "success" }] })}
        syncStatus={makeSyncStatus({ ahead: 2 })}
      />,
    );
    const svg = container.querySelector("[data-testid='icon-needs-push']");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-info");
    expect(svg?.parentElement?.parentElement).toHaveClass("bg-status-info-bg");
  });

  it("needs-push takes precedence over failing checks", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({ state: "open", checks: [{ name: "ci", status: "failure" }] })}
        syncStatus={makeSyncStatus({ ahead: 1 })}
      />,
    );
    const pushSvg = container.querySelector("[data-testid='icon-needs-push']");
    expect(pushSvg).toBeInTheDocument();
    expect(container.querySelector("[data-testid='icon-failing']")).not.toBeInTheDocument();
    expect(pushSvg?.parentElement).toHaveClass("text-status-info");
    expect(pushSvg?.parentElement).not.toHaveClass("text-status-error");
  });

  it("conflicts take precedence over needs-push", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({ state: "open", mergeable: false, merge_state_status: "DIRTY" })}
        syncStatus={makeSyncStatus({ ahead: 3 })}
      />,
    );
    const conflictSvg = container.querySelector("[data-testid='icon-conflicts']");
    expect(conflictSvg).toBeInTheDocument();
    expect(container.querySelector("[data-testid='icon-needs-push']")).not.toBeInTheDocument();
    expect(conflictSvg?.parentElement).toHaveClass("text-status-warning");
  });

  it("in-sync task shows normal check status (no needs-push override)", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({ state: "open", checks: [{ name: "ci", status: "failure" }] })}
        syncStatus={makeSyncStatus({ ahead: 0 })}
      />,
    );
    const svg = container.querySelector("[data-testid='icon-failing']");
    expect(svg).toBeInTheDocument();
    expect(container.querySelector("[data-testid='icon-needs-push']")).not.toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-error");
  });

  it("approved PR renders ShieldCheck with success colors", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          reviews: [
            {
              id: 1,
              author: "user",
              state: "APPROVED",
              body: null,
              submitted_at: "2025-01-01T00:00:00Z",
            },
          ],
        })}
      />,
    );
    const svg = container.querySelector("[data-testid='icon-approved']");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-success");
  });

  it("changes-requested PR renders ShieldX with error colors", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          reviews: [
            {
              id: 1,
              author: "user",
              state: "CHANGES_REQUESTED",
              body: null,
              submitted_at: "2025-01-01T00:00:00Z",
            },
          ],
        })}
      />,
    );
    const svg = container.querySelector("[data-testid='icon-changes-requested']");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-error");
  });

  it("changes-requested beats failing checks — shows ShieldX not CircleX", () => {
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
          reviews: [
            {
              id: 1,
              author: "user",
              state: "CHANGES_REQUESTED",
              body: null,
              submitted_at: "2025-01-01T00:00:00Z",
            },
          ],
        })}
      />,
    );
    expect(container.querySelector("[data-testid='icon-changes-requested']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='icon-failing']")).not.toBeInTheDocument();
  });

  it("conflicts beat changes-requested — shows AlertTriangle not ShieldX", () => {
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
          reviews: [
            {
              id: 1,
              author: "user",
              state: "CHANGES_REQUESTED",
              body: null,
              submitted_at: "2025-01-01T00:00:00Z",
            },
          ],
        })}
      />,
    );
    expect(container.querySelector("[data-testid='icon-conflicts']")).toBeInTheDocument();
    expect(
      container.querySelector("[data-testid='icon-changes-requested']"),
    ).not.toBeInTheDocument();
  });

  it("approved beats pending checks — shows ShieldCheck not Clock", () => {
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
          reviews: [
            {
              id: 1,
              author: "user",
              state: "APPROVED",
              body: null,
              submitted_at: "2025-01-01T00:00:00Z",
            },
          ],
        })}
      />,
    );
    expect(container.querySelector("[data-testid='icon-approved']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='icon-pending']")).not.toBeInTheDocument();
  });

  it("approved beats passing checks — shows ShieldCheck not CircleCheck", () => {
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
          reviews: [
            {
              id: 1,
              author: "user",
              state: "APPROVED",
              body: null,
              submitted_at: "2025-01-01T00:00:00Z",
            },
          ],
        })}
      />,
    );
    expect(container.querySelector("[data-testid='icon-approved']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='icon-passing']")).not.toBeInTheDocument();
  });

  it("no reviews with passing checks shows CircleCheck (passing, not open)", () => {
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
    const svg = container.querySelector("[data-testid='icon-passing']");
    expect(svg).toBeInTheDocument();
    expect(svg?.parentElement).toHaveClass("text-status-success");
    expect(container.querySelector("[data-testid='icon-open']")).not.toBeInTheDocument();
  });

  it("COMMENTED review does not count as approved — shows open icon", () => {
    const task = createMockWorkflowTaskView({
      state: { type: "done" },
      pr_url: "https://github.com/owner/repo/pull/42",
    });
    const { container } = render(
      <StatusSymbol
        task={task}
        prStatus={makePrStatus({
          state: "open",
          reviews: [
            {
              id: 1,
              author: "user",
              state: "COMMENTED",
              body: null,
              submitted_at: "2025-01-01T00:00:00Z",
            },
          ],
        })}
      />,
    );
    expect(container.querySelector("[data-testid='icon-approved']")).not.toBeInTheDocument();
    expect(container.querySelector("[data-testid='icon-open']")).toBeInTheDocument();
  });
});
