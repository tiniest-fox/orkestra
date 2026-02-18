/**
 * Tests for AutoTaskDropdown - dropdown menu for quick-creating tasks from templates.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AutoTaskTemplate } from "../types/workflow";
import { AutoTaskDropdown } from "./AutoTaskDropdown";

const mockTemplates: AutoTaskTemplate[] = [
  { filename: "template-1.yaml", title: "Bug Fix", description: "Fix a bug", auto_run: true },
  {
    filename: "template-2.yaml",
    title: "Feature",
    description: "Add feature",
    auto_run: false,
    flow: "quick",
  },
];

describe("AutoTaskDropdown", () => {
  it("returns null when templates is empty", () => {
    const { container } = render(<AutoTaskDropdown templates={[]} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders trigger when templates exist", () => {
    render(<AutoTaskDropdown templates={mockTemplates} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Task templates" })).toBeInTheDocument();
  });

  it("displays template titles in dropdown menu", () => {
    render(<AutoTaskDropdown templates={mockTemplates} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Task templates" }));

    expect(screen.getByText("Bug Fix")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
  });

  it("calls onSelect with correct template when item is clicked", () => {
    const onSelect = vi.fn();
    render(<AutoTaskDropdown templates={mockTemplates} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Task templates" }));
    fireEvent.click(screen.getByText("Bug Fix"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(mockTemplates[0]);
  });

  it("closes dropdown after selection", () => {
    render(<AutoTaskDropdown templates={mockTemplates} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Task templates" }));
    expect(screen.getByText("Bug Fix")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Bug Fix"));
    expect(screen.queryByText("Bug Fix")).not.toBeInTheDocument();
  });
});
