// Tests for RunTab — verifies port chips rendering and interaction.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunStatus } from "../../../../hooks/useRunScript";
import { RunTab } from "./RunTab";

const defaultStatus: RunStatus = { running: false, pid: null, exit_code: null };

function makeProps(overrides?: {
  ports?: Record<string, number>;
  status?: RunStatus;
  lines?: string[];
  error?: string | null;
}) {
  return {
    status: overrides?.status ?? defaultStatus,
    lines: overrides?.lines ?? [],
    ports: overrides?.ports ?? {},
    loading: false,
    error: overrides?.error ?? null,
    start: vi.fn(),
    stop: vi.fn(),
  };
}

describe("RunTab port chips", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders no port chips when ports is empty", () => {
    render(<RunTab {...makeProps()} />);
    // no chip buttons beyond Start button
    const buttons = screen.getAllByRole("button");
    // Only Start button should be present (plus optional scroll-to-bottom)
    for (const btn of buttons) {
      expect(btn).not.toHaveTextContent(/:/);
    }
  });

  it("renders a chip for a single declared port", () => {
    render(<RunTab {...makeProps({ ports: { Rails: 3000 } })} />);
    expect(screen.getByText("Rails")).toBeInTheDocument();
    expect(screen.getByText("3000")).toBeInTheDocument();
  });

  it("renders chips for multiple declared ports", () => {
    render(<RunTab {...makeProps({ ports: { Rails: 3000, React: 3002, API: 4000 } })} />);
    expect(screen.getByText("Rails")).toBeInTheDocument();
    expect(screen.getByText("3000")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("3002")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByText("4000")).toBeInTheDocument();
  });

  it("clicking a chip opens localhost URL in a new tab", async () => {
    const user = userEvent.setup();
    render(<RunTab {...makeProps({ ports: { Rails: 3000 } })} />);

    // Find the chip button containing "Rails"
    const railsLabel = screen.getByText("Rails");
    const chip = railsLabel.closest("button");
    expect(chip).not.toBeNull();

    if (chip) await user.click(chip);
    expect(window.open).toHaveBeenCalledWith("http://localhost:3000", "_blank");
  });

  it("clicking each chip opens the correct port", async () => {
    const user = userEvent.setup();
    render(<RunTab {...makeProps({ ports: { React: 3002 } })} />);

    const label = screen.getByText("React");
    const chip = label.closest("button");
    if (chip) await user.click(chip);
    expect(window.open).toHaveBeenCalledWith("http://localhost:3002", "_blank");
  });
});
